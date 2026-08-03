import { exec, spawn, type SpawnOptions } from 'node:child_process';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, rename as renamePath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createPatch } from 'diff';
import fs from 'fs-extra';
import type { FileOperation } from '../core/index.js';
import { normalizeMultilineText } from '../parser/markdown-agent.js';
import { appendHistory } from '../memory/index.js';
import { canonicalizeProjectRoot, isPathInsideProject, isReservedPath, resolveProjectPath } from '../security/project-path.js';
import { expandMkdirOperations, looksLikePowerShellCommand } from './mkdir-normalize.js';
import { preserveOperationOrder } from './operation-order.js';
import { terminateProcessTree } from './process-tree.js';
import {
  isUnsafeLegacyCommandEnabled,
  resolveToolInvocation,
  toolInputFiles,
  type ToolInvocation,
  type ToolRisk,
} from '../tools/registry.js';

const execAsync = promisify(exec);

// File operation limits to prevent memory exhaustion and excessive diff generation
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_DIFF_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

export type PathStateKind = 'missing' | 'file' | 'directory' | 'binary' | 'oversized';

export interface PathPrecondition {
  absolutePath: string;
  kind: PathStateKind;
  hash: string;
}

export interface PlannedOperation {
  operation: FileOperation;
  absolutePath: string;
  diff: string;
  risk: ToolRisk;
  preconditions: PathPrecondition[];
  affectedPaths: string[];
}

export interface ExecuteOptions {
  dryRun?: boolean;
  conversationId?: string;
  onStep?: (step: string, detail?: string) => void;
}

interface PathSnapshot {
  kind: PathStateKind;
  hash: string;
  content?: string;
  mode?: number;
  size?: number;
}

interface RollbackSnapshot extends PathSnapshot {
  absolutePath: string;
  relativePath: string;
  backupPath?: string;
  role: 'target' | 'parent';
}

interface FilesystemIdentity {
  device: string;
  inode: string;
}

interface TransactionJournal {
  id: string;
  status: 'prepared' | 'applying' | 'committed' | 'rolling_back' | 'rolled_back' | 'rollback_failed';
  projectRoot: string;
  projectRootIdentity: FilesystemIdentity;
  conversationId?: string;
  operationCount: number;
  activeOperation?: number;
  createdAt: string;
  updatedAt: string;
  rollbackStatus?: 'not_required' | 'rolled_back' | 'rollback_failed';
  error?: string;
  externalEffectsPossible: boolean;
  snapshots: Array<{
    relativePath: string;
    kind: PathStateKind;
    hash: string;
    role: 'target' | 'parent';
    backupPath?: string;
  }>;
}

interface PreparedTransaction {
  journal: TransactionJournal;
  journalPath: string;
  backupRoot: string;
  snapshots: RollbackSnapshot[];
}

interface ValidatedRollbackSnapshot {
  snapshot: RollbackSnapshot;
  absolutePath: string;
  backupPath?: string;
}

interface ValidatedRollbackTransaction {
  projectRoot: string;
  backupRoot: string;
  snapshots: ValidatedRollbackSnapshot[];
}

export async function planOperations(
  operations: FileOperation[],
  projectRoot: string,
): Promise<PlannedOperation[]> {
  const root = await canonicalizeProjectRoot(projectRoot);
  const plans: PlannedOperation[] = [];
  const virtualState = new Map<string, PathSnapshot>();
  const normalizedOperations = preserveOperationOrder(
    expandMkdirOperations(operations),
  );

  for (const operation of normalizedOperations) {
    if (operation.action === 'RUN_TOOL') {
      const cwd = operation.path
        ? await resolveProjectPath(root, operation.path, { requireExisting: true, expectedType: 'directory' })
        : root;
      const invocation = resolveToolInvocation(operation.tool ?? '', operation.args ?? [], cwd);
      const toolInputs = await planToolInputs(invocation, root, virtualState);
      plans.push({
        operation,
        absolutePath: cwd,
        diff: `RUN_TOOL [${invocation.risk}] ${invocation.displayCommand}`,
        risk: invocation.risk,
        preconditions: toolInputs.preconditions,
        affectedPaths: toolInputs.affectedPaths,
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
        preconditions: [],
        affectedPaths: [],
      });
      continue;
    }

    if (!operation.path) {
      throw new Error(`${operation.action} requires path`);
    }

    const absolutePath = await resolveFileOperationPath(root, operation);
    const filePlan = await planFileOperation(operation, absolutePath, root, virtualState);
    plans.push({
      operation,
      absolutePath,
      diff: filePlan.diff,
      risk: riskForFileOperation(operation),
      preconditions: filePlan.preconditions,
      affectedPaths: filePlan.affectedPaths,
    });
  }

  return plans;
}

export async function executeOperations(
  operations: FileOperation[],
  projectRoot: string,
  options: ExecuteOptions = {},
): Promise<PlannedOperation[]> {
  const plans = await planOperations(operations, projectRoot);
  return executePlannedOperations(plans, projectRoot, options);
}

export async function executePlannedOperations(
  plans: PlannedOperation[],
  projectRoot: string,
  options: ExecuteOptions = {},
): Promise<PlannedOperation[]> {
  const root = await canonicalizeProjectRoot(projectRoot);

  if (options.dryRun) {
    return plans;
  }

  const transaction = await prepareTransaction(root, plans, options.conversationId);

  try {
    for (const [index, plan] of plans.entries()) {
      transaction.journal.status = 'applying';
      transaction.journal.activeOperation = index;
      transaction.journal.updatedAt = new Date().toISOString();
      await writeTransactionJournal(transaction);
      await verifyPreconditions(plan.preconditions);
      await applyOperation(plan, root, options.onStep);
    }

    transaction.journal.status = 'committed';
    transaction.journal.rollbackStatus = 'not_required';
    transaction.journal.activeOperation = undefined;
    transaction.journal.updatedAt = new Date().toISOString();
    await writeTransactionJournal(transaction);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const rollbackStatus = await rollbackTransaction(transaction, message);

    try {
      await appendTransactionHistory(transaction, {
        timestamp: new Date().toISOString(),
        conversationId: options.conversationId,
        mode: 'agent',
        summary: `Operation transaction failed after ${transaction.journal.activeOperation ?? 0} completed step(s)`,
        status: 'failed',
        transactionId: transaction.journal.id,
        operationCount: plans.length,
        failedOperation: transaction.journal.activeOperation,
        rollbackStatus,
        error: message,
      });
    } catch (historyError) {
      transaction.journal.error = `${message}; history write failed: ${formatUnknownError(historyError)}`;
      transaction.journal.updatedAt = new Date().toISOString();
      await writeTransactionJournal(transaction).catch((journalError) => {
        logger.error({ journalError }, 'Failed to write transaction journal during error handling');
      });
    }

    throw new Error(
      `Operation transaction failed: ${message}. Rollback ${rollbackStatus === 'rolled_back' ? 'completed' : 'failed; inspect the transaction journal'}.`,
      { cause: error },
    );
  }

  try {
    await appendTransactionHistory(transaction, {
      timestamp: new Date().toISOString(),
      conversationId: options.conversationId,
      mode: 'agent',
      summary: `Applied ${plans.length} operation(s)`,
      status: 'committed',
      transactionId: transaction.journal.id,
      operationCount: plans.length,
      rollbackStatus: 'not_required',
    });
    await fs.remove(transaction.backupRoot);
  } catch (error) {
    const message = formatUnknownError(error);
    transaction.journal.error = `Transaction committed but finalization failed: ${message}`;
    transaction.journal.updatedAt = new Date().toISOString();
    await writeTransactionJournal(transaction).catch(() => undefined);
    throw new Error(
      `Operation transaction committed, but post-commit finalization failed: ${message}. Applied changes were not rolled back.`,
      { cause: error },
    );
  }

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
    case 'DELETE_FILE':
    case 'RENAME_FILE':
      return resolveProjectPath(projectRoot, operation.path, { expectedType: 'file' });
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
      return 'ARBITRARY_EXECUTION';
    case 'RUN_COMMAND':
      return 'DESTRUCTIVE';
    default:
      return 'WRITE';
  }
}

async function planToolInputs(
  invocation: ToolInvocation,
  projectRoot: string,
  virtualState: Map<string, PathSnapshot>,
): Promise<{ preconditions: PathPrecondition[]; affectedPaths: string[] }> {
  const preconditions: PathPrecondition[] = [];
  const affectedPaths: string[] = [];
  const bases = invocation.cwd === projectRoot ? [projectRoot] : [invocation.cwd, projectRoot];

  for (const input of toolInputFiles(invocation)) {
    const snapshots: Array<{ absolutePath: string; snapshot: PathSnapshot }> = [];
    for (const base of bases) {
      const candidate = path.join(base, input.path);
      const relative = path.relative(projectRoot, candidate);
      const absolutePath = await resolveProjectPath(projectRoot, relative, { expectedType: 'file' });
      if (snapshots.some((entry) => entry.absolutePath === absolutePath)) {
        continue;
      }
      const snapshot = await getVirtualSnapshot(virtualState, absolutePath);
      snapshots.push({ absolutePath, snapshot });
      preconditions.push(toPrecondition(absolutePath, snapshot));
      affectedPaths.push(absolutePath);
    }

    if (input.required && !snapshots.some((entry) => entry.snapshot.kind === 'file')) {
      throw new Error(
        `${invocation.toolId} requires ${input.path} before execution so the approved input can be locked`,
      );
    }
  }

  return { preconditions, affectedPaths };
}

async function planFileOperation(
  operation: FileOperation,
  absolutePath: string,
  projectRoot: string,
  virtualState: Map<string, PathSnapshot>,
): Promise<{
  diff: string;
  preconditions: PathPrecondition[];
  affectedPaths: string[];
}> {
  const relativePath = path.relative(projectRoot, absolutePath);

  if (await isReservedPath(projectRoot, absolutePath)) {
    throw new Error(`${operation.action} is not allowed on reserved metadata: ${relativePath}`);
  }

  const before = await getVirtualSnapshot(virtualState, absolutePath);
  const preconditions = [toPrecondition(absolutePath, before)];
  const affectedPaths = [absolutePath];

  switch (operation.action) {
    case 'CREATE_FOLDER': {
      if (before.kind === 'file') {
        throw new Error(`CREATE_FOLDER cannot replace file ${relativePath}`);
      }
      virtualState.set(absolutePath, createSnapshot('directory'));
      return { diff: `CREATE_FOLDER ${relativePath}`, preconditions, affectedPaths };
    }
    case 'CREATE_FILE': {
      if (before.kind === 'directory') {
        throw new Error(`CREATE_FILE cannot replace directory ${relativePath}`);
      }
      if (before.kind === 'binary') {
        throw new Error(`CREATE_FILE cannot replace binary file ${relativePath}`);
      }
      const after = normalizeMultilineText(operation.content ?? '');
      virtualState.set(absolutePath, createSnapshot('file', after));
      const diff = createPatch(relativePath, before.content ?? '', after, 'before', 'after');
      return {
        diff: truncateDiff(diff, MAX_DIFF_SIZE_BYTES),
        preconditions,
        affectedPaths,
      };
    }
    case 'EDIT_FILE': {
      if (before.kind === 'directory') {
        throw new Error(`EDIT_FILE cannot edit directory ${relativePath}`);
      }
      if (before.kind === 'binary') {
        throw new Error(`EDIT_FILE cannot edit binary file ${relativePath}`);
      }
      if (before.kind === 'missing' && !operation.content?.trim()) {
        throw new Error(
          `EDIT_FILE on missing file ${relativePath} requires full content (file will be created)`,
        );
      }
      const after = nextContent(operation, before.content ?? '');
      virtualState.set(absolutePath, createSnapshot('file', after));
      const diff = createPatch(relativePath, before.content ?? '', after, 'before', 'after');
      return {
        diff: truncateDiff(diff, MAX_DIFF_SIZE_BYTES),
        preconditions,
        affectedPaths,
      };
    }
    case 'DELETE_FILE': {
      if (before.kind !== 'file' && before.kind !== 'binary') {
        throw new Error(`DELETE_FILE requires existing file ${relativePath}`);
      }
      virtualState.set(absolutePath, createSnapshot('missing'));
      const diff = createPatch(relativePath, before.content ?? '', '', 'before', 'after');
      return {
        diff: truncateDiff(diff, MAX_DIFF_SIZE_BYTES),
        preconditions,
        affectedPaths,
      };
    }
    case 'RENAME_FILE': {
      if (before.kind !== 'file') {
        throw new Error(`RENAME_FILE requires existing file ${relativePath}`);
      }
      if (!operation.replace) {
        throw new Error('RENAME_FILE requires replace as destination path');
      }
      const destination = await resolveProjectPath(projectRoot, operation.replace, { expectedType: 'file' });

      if (await isReservedPath(projectRoot, destination)) {
        throw new Error(`RENAME_FILE destination is reserved metadata: ${path.relative(projectRoot, destination)}`);
      }

      const destinationBefore = await getVirtualSnapshot(virtualState, destination);
      if (destinationBefore.kind !== 'missing') {
        throw new Error(`RENAME_FILE destination already exists: ${path.relative(projectRoot, destination)}`);
      }
      preconditions.push(toPrecondition(destination, destinationBefore));
      affectedPaths.push(destination);
      virtualState.set(absolutePath, createSnapshot('missing'));
      virtualState.set(destination, createSnapshot('file', before.content ?? '', before.mode));
      return {
        diff: `RENAME_FILE ${relativePath} -> ${path.relative(projectRoot, destination)}`,
        preconditions,
        affectedPaths,
      };
    }
    default:
      throw new Error(`${operation.action} is not a file operation`);
  }
}

async function getVirtualSnapshot(
  virtualState: Map<string, PathSnapshot>,
  absolutePath: string,
): Promise<PathSnapshot> {
  const existing = virtualState.get(absolutePath);
  if (existing) {
    return existing;
  }
  const snapshot = await readPathSnapshot(absolutePath);
  virtualState.set(absolutePath, snapshot);
  return snapshot;
}

function createSnapshot(
  kind: PathStateKind,
  content?: string,
  mode?: number,
  size?: number,
): PathSnapshot {
  return {
    kind,
    content: kind === 'file' ? content ?? '' : undefined,
    mode,
    size,
    hash: hashPathState(kind, content),
  };
}

function toPrecondition(absolutePath: string, snapshot: PathSnapshot): PathPrecondition {
  return {
    absolutePath,
    kind: snapshot.kind,
    hash: snapshot.hash,
  };
}

async function readPathSnapshot(absolutePath: string): Promise<PathSnapshot> {
  if (!(await fs.pathExists(absolutePath))) {
    return createSnapshot('missing');
  }

  const stats = await fs.lstat(absolutePath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Symbolic links are not valid operation targets: ${absolutePath}`);
  }
  if (stats.isDirectory()) {
    return createSnapshot('directory', undefined, stats.mode);
  }
  if (!stats.isFile()) {
    throw new Error(`Unsupported filesystem target: ${absolutePath}`);
  }

  // Check file size before reading
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File exceeds maximum size for operation planning: ${absolutePath} ` +
      `(${formatBytes(stats.size)} > ${formatBytes(MAX_FILE_SIZE_BYTES)})`,
    );
  }

  // Read the file
  const buffer = await fs.readFile(absolutePath);

  // Detect binary content by checking for null bytes
  if (isBinaryContent(buffer)) {
    return createSnapshot('binary', undefined, stats.mode, stats.size);
  }

  const content = buffer.toString('utf8');
  return createSnapshot('file', content, stats.mode, stats.size);
}

function isBinaryContent(buffer: Buffer): boolean {
  // Check for null bytes which indicate binary content
  for (let i = 0; i < Math.min(buffer.length, 8192); i += 1) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateDiff(diff: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(diff, 'utf8');
  if (bytes <= maxBytes) {
    return diff;
  }

  // Truncate and add indicator
  let truncated = '';
  let currentBytes = 0;
  const lines = diff.split('\n');

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line + '\n', 'utf8');
    if (currentBytes + lineBytes > maxBytes - 100) {
      break;
    }
    truncated += line + '\n';
    currentBytes += lineBytes;
  }

  return truncated + `\n... (diff truncated: ${formatBytes(bytes)} > ${formatBytes(maxBytes)})\n`;
}

function hashPathState(kind: PathStateKind, content?: string): string {
  return crypto
    .createHash('sha256')
    .update(kind)
    .update('\0')
    .update(kind === 'file' ? content ?? '' : '')
    .digest('hex');
}

async function verifyPreconditions(preconditions: PathPrecondition[]): Promise<void> {
  for (const expected of preconditions) {
    const actual = await readPathSnapshot(expected.absolutePath);
    if (actual.kind !== expected.kind || actual.hash !== expected.hash) {
      throw new Error(`Operation precondition changed for ${expected.absolutePath}`);
    }
  }
}

async function prepareTransaction(
  projectRoot: string,
  plans: PlannedOperation[],
  conversationId?: string,
): Promise<PreparedTransaction> {
  const id = crypto.randomUUID();
  const transactionsRoot = path.join(projectRoot, '.openbrowser', 'transactions');
  const journalPath = path.join(transactionsRoot, `${id}.json`);
  const backupRoot = path.join(transactionsRoot, `${id}.backup`);
  const projectRootIdentity = await readFilesystemIdentity(projectRoot);
  const firstPreconditions = new Map<string, PathPrecondition>();

  for (const plan of plans) {
    for (const precondition of plan.preconditions) {
      if (!firstPreconditions.has(precondition.absolutePath)) {
        firstPreconditions.set(precondition.absolutePath, precondition);
      }
    }
  }

  for (const precondition of firstPreconditions.values()) {
    await verifyPreconditions([precondition]);
  }

  const snapshots: RollbackSnapshot[] = [];
  for (const absolutePath of firstPreconditions.keys()) {
    const snapshot = await readPathSnapshot(absolutePath);
    snapshots.push({
      ...snapshot,
      absolutePath,
      relativePath: path.relative(projectRoot, absolutePath),
      role: 'target',
    });
  }

  const parentPaths = collectParentPaths(projectRoot, [...firstPreconditions.keys()]);
  for (const absolutePath of parentPaths) {
    const snapshot = await readPathSnapshot(absolutePath);
    snapshots.push({
      ...snapshot,
      absolutePath,
      relativePath: path.relative(projectRoot, absolutePath),
      role: 'parent',
    });
  }

  await fs.ensureDir(backupRoot);
  let backupIndex = 0;
  for (const snapshot of snapshots) {
    if (snapshot.kind !== 'file') {
      continue;
    }
    const backupPath = path.join(backupRoot, `${backupIndex}.bak`);
    backupIndex += 1;
    await fs.copyFile(snapshot.absolutePath, backupPath);
    snapshot.backupPath = backupPath;
  }

  const now = new Date().toISOString();
  const journal: TransactionJournal = {
    id,
    status: 'prepared',
    projectRoot,
    projectRootIdentity,
    conversationId,
    operationCount: plans.length,
    createdAt: now,
    updatedAt: now,
    externalEffectsPossible: plans.some((plan) =>
      plan.operation.action === 'RUN_COMMAND' ||
      (plan.operation.action === 'RUN_TOOL' && plan.risk !== 'READ')
    ),
    snapshots: snapshots.map((snapshot) => ({
      relativePath: snapshot.relativePath,
      kind: snapshot.kind,
      hash: snapshot.hash,
      role: snapshot.role,
      backupPath: snapshot.backupPath ? path.relative(transactionsRoot, snapshot.backupPath) : undefined,
    })),
  };

  const transaction = { journal, journalPath, backupRoot, snapshots };
  await writeTransactionJournal(transaction);
  return transaction;
}

function collectParentPaths(projectRoot: string, targets: string[]): string[] {
  const parents = new Set<string>();
  for (const target of targets) {
    let current = path.dirname(target);
    while (current !== projectRoot && path.relative(projectRoot, current) && !path.relative(projectRoot, current).startsWith('..')) {
      if (!current.startsWith(path.join(projectRoot, '.openbrowser', 'transactions'))) {
        parents.add(current);
      }
      current = path.dirname(current);
    }
  }
  return [...parents].sort((left, right) => pathDepth(left) - pathDepth(right));
}

async function rollbackTransaction(
  transaction: PreparedTransaction,
  errorMessage: string,
): Promise<'rolled_back' | 'rollback_failed'> {
  try {
    let projectRoot: string;
    try {
      projectRoot = await canonicalizeProjectRoot(transaction.journal.projectRoot);
    } catch (error) {
      throw new Error(`Project root validation failed during rollback: ${formatUnknownError(error)}`);
    }

    const targets = transaction.snapshots
      .filter((snapshot) => snapshot.role === 'target')
      .sort((left, right) => pathDepth(right.absolutePath) - pathDepth(left.absolutePath));

    for (const snapshot of targets) {
      await validateAndRollbackTarget(snapshot, projectRoot, transaction.backupRoot);
    }

    const parents = transaction.snapshots
      .filter((snapshot) => snapshot.role === 'parent')
      .sort((left, right) => pathDepth(right.absolutePath) - pathDepth(left.absolutePath));
    for (const snapshot of parents) {
      await validateAndRollbackParent(snapshot, projectRoot);
    }

    transaction.journal.status = 'rolled_back';
    transaction.journal.rollbackStatus = 'rolled_back';
    transaction.journal.updatedAt = new Date().toISOString();
    await fs.remove(validated.backupRoot);
    await writeTransactionJournal(transaction);
    return 'rolled_back';
  } catch (rollbackError) {
    transaction.journal.status = 'rollback_failed';
    transaction.journal.rollbackStatus = 'rollback_failed';
    transaction.journal.error = `${errorMessage}; rollback failed: ${formatUnknownError(rollbackError)}`;
    transaction.journal.updatedAt = new Date().toISOString();
    await writeTransactionJournal(transaction).catch(() => undefined);
    return 'rollback_failed';
  }
}

async function validateAndRollbackTarget(
  snapshot: RollbackSnapshot,
  projectRoot: string,
  backupRoot: string,
): Promise<void> {
  if (!isPathInsideProject(projectRoot, snapshot.absolutePath)) {
    throw new Error(`Rollback target escapes project root: ${snapshot.relativePath}`);
  }

  const targetCanonical = await validateTargetPath(snapshot.absolutePath, projectRoot);

  if (snapshot.kind === 'missing') {
    await fs.remove(targetCanonical);
    return;
  }

  if (snapshot.kind === 'directory') {
    if (await fs.pathExists(targetCanonical)) {
      const current = await lstat(targetCanonical);
      if (!current.isSymbolicLink() && current.isDirectory()) {
        return;
      }
      if (current.isSymbolicLink()) {
        throw new Error(`Cannot rollback: target is now a symlink/junction: ${snapshot.relativePath}`);
      }
      await fs.remove(targetCanonical);
    }
    await fs.ensureDir(targetCanonical);
    return;
  }

  if (!snapshot.backupPath) {
    throw new Error(`Missing rollback backup for ${snapshot.relativePath}`);
  }

  const backupCanonical = await validateBackupPath(snapshot.backupPath, backupRoot);
  await fs.remove(targetCanonical);
  await fs.ensureDir(path.dirname(targetCanonical));
  await validateParentDirectory(path.dirname(targetCanonical), projectRoot);
  await fs.copyFile(backupCanonical, targetCanonical);
  if (snapshot.mode !== undefined) {
    await fs.chmod(targetCanonical, snapshot.mode);
  }
}

async function validateAndRollbackParent(
  snapshot: RollbackSnapshot,
  projectRoot: string,
): Promise<void> {
  if (!isPathInsideProject(projectRoot, snapshot.absolutePath)) {
    throw new Error(`Rollback parent escapes project root: ${snapshot.relativePath}`);
  }

  const parentCanonical = await validateTargetPath(snapshot.absolutePath, projectRoot);

  if (snapshot.kind === 'missing') {
    try {
      await fs.rmdir(parentCanonical);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') {
        throw error;
      }
    }
  } else if (snapshot.kind === 'directory') {
    await fs.ensureDir(parentCanonical);
  }
}

async function validateTargetPath(absolutePath: string, projectRoot: string): Promise<string> {
  try {
    const canonical = await realpath(absolutePath);
    if (!isPathInsideProject(projectRoot, canonical)) {
      throw new Error(`Path escapes project root after symlink resolution`);
    }
    return canonical;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const parent = path.dirname(absolutePath);
      const parentCanonical = await realpath(parent);
      if (!isPathInsideProject(projectRoot, parentCanonical)) {
        throw new Error(`Parent directory escapes project root`);
      }
      const candidate = path.join(parentCanonical, path.basename(absolutePath));
      if (!isPathInsideProject(projectRoot, candidate)) {
        throw new Error(`Path escapes project root`);
      }
      return candidate;
    }
    throw error;
  }
}

async function validateBackupPath(backupPath: string, backupRoot: string): Promise<string> {
  const canonical = await realpath(backupPath);
  if (!canonical.startsWith(backupRoot)) {
    throw new Error(`Backup file is outside backup root: ${backupPath}`);
  }
  const stat = await lstat(canonical);
  if (!stat.isFile()) {
    throw new Error(`Backup must be a regular file: ${backupPath}`);
  }
  return canonical;
}

async function validateParentDirectory(parentPath: string, projectRoot: string): Promise<void> {
  const parentCanonical = await realpath(parentPath);
  if (!isPathInsideProject(projectRoot, parentCanonical)) {
    throw new Error(`Parent directory escapes project root: ${parentPath}`);
  }
  const stat = await lstat(parentCanonical);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Parent must be a regular directory: ${parentPath}`);
  }
}

async function writeTransactionJournal(transaction: PreparedTransaction): Promise<void> {
  const relativePath = path.relative(
    transaction.journal.projectRoot,
    transaction.journalPath,
  );
  const journalPath = await resolveTransactionMetadataPath(transaction, relativePath);
  await safeWriteFile(journalPath, JSON.stringify(transaction.journal, null, 2));
}

function pathDepth(value: string): number {
  return value.split(path.sep).length;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollowFlag;
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.openbrowser-${crypto.randomUUID()}.tmp`,
  );
  const existingMode = await fs.stat(filePath).then((stats) => stats.mode).catch((statError) => {
    logger.debug({ filePath, statError }, 'Could not stat existing file; will use default mode');
    return undefined;
  });
  const handle = await open(temporaryPath, flags, existingMode ?? 0o666);
  try {
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }

  try {
    if (existingMode !== undefined) {
      await fs.chmod(temporaryPath, existingMode);
    }
    await renamePath(temporaryPath, filePath);
  } catch (error) {
    await fs.remove(temporaryPath).catch((removeError) => {
      logger.warn({ temporaryPath, removeError }, 'Failed to clean up temporary file during error recovery');
    });
    throw error;
  }
}

async function runTool(invocation: ToolInvocation): Promise<void> {
  const maxOutputBytes = 2 * 1024 * 1024;
  const timeoutMs = 120_000;
  const gracefulTerminationTimeoutMs = 1000;

  await new Promise<void>((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      cwd: invocation.cwd,
      shell: false,
      windowsHide: true,
      env: process.env,
      detached: process.platform !== 'win32',
    };

    const child = spawn(invocation.executable, invocation.args, spawnOptions);

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

    const handleTermination = async (reason: string): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const result = await terminateProcessTree(child.pid!, gracefulTerminationTimeoutMs);
      let errorMsg = `${invocation.toolId}: ${reason}`;

      if (result.descendantCount > 0) {
        errorMsg += ` (terminated ${result.descendantCount} descendant process(es)`;
        if (result.gracefulTermination) {
          errorMsg += ', graceful)';
        } else if (result.forcedTermination) {
          errorMsg += ', forced)';
        } else {
          errorMsg += ')';
        }
      }

      if (result.error) {
        errorMsg += ` - ${result.error}`;
      }

      reject(new Error(errorMsg));
    };

    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        handleTermination(`output exceeded ${maxOutputBytes} bytes`);
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
      handleTermination(`timed out after ${timeoutMs}ms`);
    }, timeoutMs);
  });

  if (result.stdout.trim()) {
    process.stdout.write(`${result.stdout.trim()}\n`);
  }
  if (result.stderr.trim()) {
    process.stderr.write(`${result.stderr.trim()}\n`);
  }
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

    // Count occurrences of search text
    let count = 0;
    let index = 0;
    while ((index = before.indexOf(search, index)) !== -1) {
      count += 1;
      index += search.length;
    }

    if (count === 0) {
      throw new Error(`Search text not found in ${operation.path}`);
    }

    if (count > 1) {
      throw new Error(
        `Search text in ${operation.path} is ambiguous: found ${count} matches. ` +
        `Provide additional context or an occurrence specifier to disambiguate.`,
      );
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
  const lineCount = lines.length;

  if (startLine > lineCount + 1) {
    throw new Error(
      `startLine ${startLine} is beyond end of file (${lineCount} lines total)`,
    );
  }

  // Reject endLine beyond file length unless it's for an append operation
  // An append operation has startLine at or beyond EOF and endLine equal to lineCount+1
  if (endLine > lineCount + 1) {
    throw new Error(
      `endLine ${endLine} is beyond end of file (${lineCount} lines total). ` +
      `To append at EOF, use startLine=${lineCount + 1} and endLine=${lineCount + 1}.`,
    );
  }

  if (endLine === lineCount + 1 && startLine <= lineCount) {
    throw new Error(
      `endLine cannot extend beyond file length. ` +
      `File has ${lineCount} lines. To append, use startLine=${lineCount + 1} and endLine=${lineCount + 1}.`,
    );
  }

  if (endLine > lines.length) {
    throw new Error(`endLine ${endLine} is beyond end of file (${lines.length} lines)`);
  }

  const startIndex = startLine - 1;
  const endIndex = endLine > lineCount ? lineCount : endLine;
  const replacementLines = replacement.split('\n');

  return [
    ...lines.slice(0, startIndex),
    ...replacementLines,
    ...lines.slice(endIndex),
  ].join('\n');
}

function countOccurrences(text: string, search: string): number {
  if (search.length === 0) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(search, index)) !== -1) {
    count += 1;
    index += search.length;
  }
  return count;
}

function validateDiffSize(diff: string, filePath: string): void {
  if (diff.length > MAX_DIFF_BYTES) {
    throw new Error(`Diff for ${filePath} is too large (${diff.length} bytes, limit ${MAX_DIFF_BYTES} bytes); cannot generate complete preview`);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported operation: ${value}`);
}
