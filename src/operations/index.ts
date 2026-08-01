import { exec, spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createPatch } from 'diff';
import fs from 'fs-extra';
import type { FileOperation } from '../core/index.js';
import { normalizeMultilineText } from '../parser/markdown-agent.js';
import { appendHistory } from '../memory/index.js';
import { canonicalizeProjectRoot, resolveProjectPath } from '../security/project-path.js';
import { expandMkdirOperations, looksLikePowerShellCommand } from './mkdir-normalize.js';
import { preserveOperationOrder } from './operation-order.js';
import {
  isUnsafeLegacyCommandEnabled,
  resolveToolInvocation,
  type ToolInvocation,
  type ToolRisk,
} from '../tools/registry.js';

const execAsync = promisify(exec);

export interface PlannedOperation {
  operation: FileOperation;
  absolutePath: string;
  diff: string;
  risk: ToolRisk;
}

export interface ExecuteOptions {
  dryRun?: boolean;
  conversationId?: string;
  onStep?: (step: string, detail?: string) => void;
}

export async function planOperations(
  operations: FileOperation[],
  projectRoot: string,
): Promise<PlannedOperation[]> {
  const root = await canonicalizeProjectRoot(projectRoot);
  const plans: PlannedOperation[] = [];
  const normalizedOperations = preserveOperationOrder(
    expandMkdirOperations(operations),
  );

  for (const operation of normalizedOperations) {
    if (operation.action === 'RUN_TOOL') {
      const cwd = operation.path
        ? await resolveProjectPath(root, operation.path, { requireExisting: true, expectedType: 'directory' })
        : root;
      const invocation = resolveToolInvocation(operation.tool ?? '', operation.args ?? [], cwd);
      plans.push({
        operation,
        absolutePath: cwd,
        diff: `RUN_TOOL [${invocation.risk}] ${invocation.displayCommand}`,
        risk: invocation.risk,
      });
      continue;
    }

    if (operation.action === 'RUN_COMMAND') {
      if (!isUnsafeLegacyCommandEnabled()) {
        throw new Error(
          'RUN_COMMAND is disabled. Use RUN_TOOL, or set OPENBROWSER_ALLOW_UNSAFE_COMMANDS=1 for explicit legacy opt-in.',
        );
      }
      const cwd = operation.path
        ? await resolveProjectPath(root, operation.path, { requireExisting: true, expectedType: 'directory' })
        : root;
      plans.push({
        operation,
        absolutePath: cwd,
        diff: `RUN_COMMAND [UNSAFE] ${operation.command ?? ''}`,
        risk: 'DESTRUCTIVE',
      });
      continue;
    }

    if (!operation.path) {
      throw new Error(`${operation.action} requires path`);
    }

    const absolutePath = await resolveFileOperationPath(root, operation);
    plans.push({
      operation,
      absolutePath,
      diff: await buildDiff(operation, absolutePath, root),
      risk: riskForFileOperation(operation),
    });
  }

  return plans;
}

export async function executeOperations(
  operations: FileOperation[],
  projectRoot: string,
  options: ExecuteOptions = {},
): Promise<PlannedOperation[]> {
  const root = await canonicalizeProjectRoot(projectRoot);
  const plans = await planOperations(operations, root);

  if (options.dryRun) {
    return plans;
  }

  for (const plan of plans) {
    await applyOperation(plan, root, options.onStep);
  }

  await appendHistory(root, {
    timestamp: new Date().toISOString(),
    conversationId: options.conversationId,
    mode: 'agent',
    summary: `Applied ${plans.length} operation(s)`,
  });

  return plans;
}

async function resolveFileOperationPath(
  projectRoot: string,
  operation: FileOperation,
): Promise<string> {
  if (!operation.path) {
    throw new Error(`${operation.action} requires path`);
  }

  switch (operation.action) {
    case 'CREATE_FOLDER':
      return resolveProjectPath(projectRoot, operation.path, { expectedType: 'directory' });
    case 'CREATE_FILE':
    case 'EDIT_FILE':
      return resolveProjectPath(projectRoot, operation.path, { expectedType: 'file' });
    case 'DELETE_FILE':
    case 'RENAME_FILE':
      return resolveProjectPath(projectRoot, operation.path, { requireExisting: true, expectedType: 'file' });
    default:
      throw new Error(`${operation.action} is not a file operation`);
  }
}

function riskForFileOperation(operation: FileOperation): ToolRisk {
  switch (operation.action) {
    case 'DELETE_FILE':
      return 'DESTRUCTIVE';
    case 'CREATE_FILE':
    case 'EDIT_FILE':
    case 'RENAME_FILE':
    case 'CREATE_FOLDER':
      return 'WRITE';
    case 'RUN_TOOL':
      return 'SAFE_EXECUTION';
    case 'RUN_COMMAND':
      return 'DESTRUCTIVE';
    default:
      return 'WRITE';
  }
}

async function buildDiff(
  operation: FileOperation,
  absolutePath: string,
  projectRoot: string,
): Promise<string> {
  const relativePath = path.relative(projectRoot, absolutePath);

  if (operation.action === 'CREATE_FOLDER') {
    return `CREATE_FOLDER ${relativePath}`;
  }

  if (operation.action === 'RENAME_FILE') {
    if (!operation.replace) {
      throw new Error('RENAME_FILE requires replace as destination path');
    }
    await resolveProjectPath(projectRoot, operation.replace, { expectedType: 'file' });
    return `RENAME_FILE ${relativePath} -> ${operation.replace}`;
  }

  const before = (await fs.pathExists(absolutePath))
    ? await fs.readFile(absolutePath, 'utf8')
    : '';

  if (operation.action === 'DELETE_FILE') {
    return createPatch(relativePath, before, '', 'before', 'after');
  }

  const after = nextContent(operation, before);
  return createPatch(relativePath, before, after, 'before', 'after');
}

async function applyOperation(
  plan: PlannedOperation,
  projectRoot: string,
  onStep?: (step: string, detail?: string) => void,
): Promise<void> {
  const { operation } = plan;

  switch (operation.action) {
    case 'RUN_TOOL': {
      const cwd = operation.path
        ? await resolveProjectPath(projectRoot, operation.path, { requireExisting: true, expectedType: 'directory' })
        : projectRoot;
      const invocation = resolveToolInvocation(operation.tool ?? '', operation.args ?? [], cwd);
      onStep?.('running command', `${invocation.toolId} [${invocation.risk}]`);
      await runTool(invocation);
      break;
    }
    case 'RUN_COMMAND': {
      if (!isUnsafeLegacyCommandEnabled()) {
        throw new Error(
          'RUN_COMMAND is disabled. Use RUN_TOOL, or set OPENBROWSER_ALLOW_UNSAFE_COMMANDS=1 for explicit legacy opt-in.',
        );
      }
      const cwd = operation.path
        ? await resolveProjectPath(projectRoot, operation.path, { requireExisting: true, expectedType: 'directory' })
        : projectRoot;
      onStep?.('running command', `UNSAFE legacy command: ${operation.command ?? ''}`);
      await runShellCommand(operation.command ?? '', cwd);
      break;
    }
    case 'CREATE_FOLDER': {
      const operationPath = requireOperationPath(operation);
      const absolutePath = await resolveProjectPath(projectRoot, operationPath, { expectedType: 'directory' });
      const relativePath = path.relative(projectRoot, absolutePath);
      onStep?.('creating folder', relativePath);
      await fs.ensureDir(absolutePath);
      await resolveProjectPath(projectRoot, operationPath, { requireExisting: true, expectedType: 'directory' });
      break;
    }
    case 'CREATE_FILE': {
      const operationPath = requireOperationPath(operation);
      let absolutePath = await resolveProjectPath(projectRoot, operationPath, { expectedType: 'file' });
      const relativePath = path.relative(projectRoot, absolutePath);
      onStep?.('creating file', relativePath);
      await fs.ensureDir(path.dirname(absolutePath));
      await revalidateParentDirectory(projectRoot, absolutePath);
      absolutePath = await resolveProjectPath(projectRoot, operationPath, { expectedType: 'file' });
      await safeWriteFile(absolutePath, operation.content ?? '');
      break;
    }
    case 'EDIT_FILE': {
      const operationPath = requireOperationPath(operation);
      let absolutePath = await resolveProjectPath(projectRoot, operationPath, { expectedType: 'file' });
      const relativePath = path.relative(projectRoot, absolutePath);
      const exists = await fs.pathExists(absolutePath);
      if (!exists) {
        if (!operation.content?.trim()) {
          throw new Error(
            `EDIT_FILE on missing file ${relativePath} requires full content (file will be created)`,
          );
        }
        onStep?.('creating file', `${relativePath} (via EDIT_FILE)`);
        await fs.ensureDir(path.dirname(absolutePath));
        await revalidateParentDirectory(projectRoot, absolutePath);
        absolutePath = await resolveProjectPath(projectRoot, operationPath, { expectedType: 'file' });
        await safeWriteFile(absolutePath, operation.content ?? '');
        break;
      }

      onStep?.('editing file', relativePath);
      const before = await fs.readFile(absolutePath, 'utf8');
      absolutePath = await resolveProjectPath(projectRoot, operationPath, { requireExisting: true, expectedType: 'file' });
      await revalidateParentDirectory(projectRoot, absolutePath);
      await safeWriteFile(absolutePath, nextContent(operation, before));
      break;
    }
    case 'DELETE_FILE': {
      const operationPath = requireOperationPath(operation);
      const absolutePath = await resolveProjectPath(projectRoot, operationPath, { requireExisting: true, expectedType: 'file' });
      const relativePath = path.relative(projectRoot, absolutePath);
      onStep?.('deleting file', relativePath);
      await unlink(absolutePath);
      break;
    }
    case 'RENAME_FILE': {
      const operationPath = requireOperationPath(operation);
      let absolutePath = await resolveProjectPath(projectRoot, operationPath, { requireExisting: true, expectedType: 'file' });
      const relativePath = path.relative(projectRoot, absolutePath);
      onStep?.('renaming file', relativePath);
      if (!operation.replace) {
        throw new Error('RENAME_FILE requires replace as destination path');
      }
      let destination = await resolveProjectPath(projectRoot, operation.replace, { expectedType: 'file' });
      await fs.ensureDir(path.dirname(destination));
      await revalidateParentDirectory(projectRoot, destination);
      absolutePath = await resolveProjectPath(projectRoot, operationPath, { requireExisting: true, expectedType: 'file' });
      destination = await resolveProjectPath(projectRoot, operation.replace, { expectedType: 'file' });
      await fs.move(absolutePath, destination, { overwrite: false });
      break;
    }
    default:
      assertNever(operation.action);
  }
}

function requireOperationPath(operation: FileOperation): string {
  if (!operation.path) {
    throw new Error(`${operation.action} requires path`);
  }
  return operation.path;
}

async function revalidateParentDirectory(projectRoot: string, targetPath: string): Promise<void> {
  await resolveProjectPath(projectRoot, path.dirname(targetPath), {
    requireExisting: true,
    expectedType: 'directory',
  });
}

async function safeWriteFile(filePath: string, content: string): Promise<void> {
  const noFollowFlag = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW;
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | noFollowFlag;
  const handle = await open(filePath, flags, 0o666);
  try {
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}

async function runTool(invocation: ToolInvocation): Promise<void> {
  const maxOutputBytes = 2 * 1024 * 1024;
  const timeoutMs = 120_000;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      shell: false,
      windowsHide: true,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        finish(new Error(`Tool output exceeded ${maxOutputBytes} bytes`));
        return;
      }
      if (target === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
    };

    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.on('error', (error) => finish(new Error(`Failed to start ${invocation.toolId}: ${error.message}`)));
    child.on('close', (code, signal) => {
      if (stdout.trim()) process.stdout.write(`${stdout.trim()}\n`);
      if (stderr.trim()) process.stderr.write(`${stderr.trim()}\n`);
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new Error(
          `${invocation.toolId} failed${code === null ? '' : ` with exit code ${code}`}${signal ? ` (${signal})` : ''}`,
        ),
      );
    });

    timer = setTimeout(() => {
      child.kill();
      finish(new Error(`${invocation.toolId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

async function runShellCommand(command: string, cwd: string): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error('RUN_COMMAND is empty');
  }

  const shell = resolveShell(trimmed);

  try {
    const { stdout, stderr } = await execAsync(trimmed, {
      cwd,
      shell,
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    if (stdout.trim()) {
      process.stdout.write(`${stdout.trim()}\n`);
    }
    if (stderr.trim()) {
      process.stderr.write(`${stderr.trim()}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Command failed: ${message}`);
  }
}

function resolveShell(command: string): string {
  if (process.platform !== 'win32') {
    return '/bin/sh';
  }

  if (looksLikePowerShellCommand(command)) {
    return 'powershell.exe';
  }

  return process.env.COMSPEC ?? 'cmd.exe';
}

function nextContent(operation: FileOperation, before: string): string {
  if (
    operation.startLine !== undefined &&
    operation.endLine !== undefined &&
    operation.replace !== undefined
  ) {
    return applyLineEdit(
      before,
      operation.startLine,
      operation.endLine,
      normalizeMultilineText(operation.replace),
    );
  }

  if (operation.search !== undefined && operation.replace !== undefined) {
    const search = normalizeMultilineText(operation.search);
    const replace = normalizeMultilineText(operation.replace);
    if (!before.includes(search)) {
      throw new Error(`Search text not found in ${operation.path}`);
    }
    return before.replace(search, replace);
  }

  if (operation.content !== undefined) {
    return normalizeMultilineText(operation.content);
  }

  throw new Error(`${operation.action} requires content, line edit, or search/replace`);
}

function applyLineEdit(
  before: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string {
  if (startLine < 1 || endLine < startLine) {
    throw new Error(`Invalid line range ${startLine}-${endLine} for edit`);
  }

  const lines = before.split('\n');
  if (startLine > lines.length + 1) {
    throw new Error(`startLine ${startLine} is beyond end of file (${lines.length} lines)`);
  }

  const startIndex = startLine - 1;
  const endIndex = Math.min(endLine, lines.length);
  const replacementLines = replacement.split('\n');

  return [
    ...lines.slice(0, startIndex),
    ...replacementLines,
    ...lines.slice(endIndex),
  ].join('\n');
}

function assertNever(value: never): never {
  throw new Error(`Unsupported operation: ${value}`);
}
