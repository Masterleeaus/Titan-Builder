import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import fs from 'fs-extra';
import type { FileOperation } from '../core/index.js';
import {
  openVerifiedRegularFile,
  sameFileIdentity,
  type FileIdentity,
} from '../security/verified-file.js';
import * as core from './index-core.js';

export type PathStateKind = core.PathStateKind;

export interface PathPrecondition extends core.PathPrecondition {
  identity?: FileIdentity;
}

export interface PlannedOperation extends Omit<core.PlannedOperation, 'preconditions'> {
  preconditions: PathPrecondition[];
}

export interface OperationSecurityHooks {
  afterPreconditionCapture?: () => Promise<void> | void;
  afterTransactionBackup?: (context: { backupRoot: string }) => Promise<void> | void;
}

export interface ExecuteOptions extends core.ExecuteOptions {
  securityHooks?: OperationSecurityHooks;
}

interface CapturedFile {
  absolutePath: string;
  identity: FileIdentity;
  bytes: Buffer;
  contentHash: string;
  mode: number;
  readCount: number;
}

interface ExecutionContext {
  captures: Map<string, CapturedFile>;
  hooks?: OperationSecurityHooks;
  preconditionHookComplete: boolean;
  backupHookComplete: boolean;
  backupCount: number;
}

const executionContext = new AsyncLocalStorage<ExecutionContext>();
const mutableFs = fs as typeof fs & {
  readFile: (...args: unknown[]) => Promise<unknown>;
  copyFile: (...args: unknown[]) => Promise<void>;
};
const originalReadFile = mutableFs.readFile.bind(mutableFs);
const originalCopyFile = mutableFs.copyFile.bind(mutableFs);
let filesystemInterceptorsInstalled = false;

installFilesystemInterceptors();

export async function planOperations(
  operations: FileOperation[],
  projectRoot: string,
): Promise<PlannedOperation[]> {
  const plans = await core.planOperations(operations, projectRoot) as PlannedOperation[];
  const approvedPaths = new Set<string>();

  for (const plan of plans) {
    for (const precondition of plan.preconditions) {
      if (precondition.kind !== 'file' || approvedPaths.has(precondition.absolutePath)) {
        continue;
      }
      approvedPaths.add(precondition.absolutePath);
      const verified = await openVerifiedRegularFile(precondition.absolutePath);
      try {
        const bytes = await verified.readBuffer();
        assertContentHash(precondition, bytes);
        precondition.identity = verified.identity;
      } finally {
        await verified.close();
      }
    }
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
  if (options.dryRun) {
    return core.executePlannedOperations(
      plans as core.PlannedOperation[],
      projectRoot,
      stripSecurityHooks(options),
    ) as Promise<PlannedOperation[]>;
  }

  const captures = await captureApprovedFiles(plans);
  const context: ExecutionContext = {
    captures,
    hooks: options.securityHooks,
    preconditionHookComplete: false,
    backupHookComplete: false,
    backupCount: 0,
  };

  return executionContext.run(context, async () =>
    core.executePlannedOperations(
      plans as core.PlannedOperation[],
      projectRoot,
      stripSecurityHooks(options),
    ) as Promise<PlannedOperation[]>,
  );
}

async function captureApprovedFiles(
  plans: PlannedOperation[],
): Promise<Map<string, CapturedFile>> {
  const captures = new Map<string, CapturedFile>();
  const firstPreconditions = new Map<string, PathPrecondition>();

  for (const plan of plans) {
    for (const precondition of plan.preconditions) {
      if (!firstPreconditions.has(precondition.absolutePath)) {
        firstPreconditions.set(precondition.absolutePath, precondition);
      }
    }
  }

  for (const precondition of firstPreconditions.values()) {
    if (precondition.kind !== 'file') continue;
    if (!precondition.identity) {
      throw new Error(
        `Operation precondition is missing approved file identity for ${precondition.absolutePath}; regenerate the preview`,
      );
    }

    const verified = await openVerifiedRegularFile(precondition.absolutePath);
    try {
      if (!sameFileIdentity(precondition.identity, verified.identity)) {
        throw new Error(`Operation precondition identity changed for ${precondition.absolutePath}`);
      }
      const bytes = await verified.readBuffer();
      assertContentHash(precondition, bytes);
      captures.set(normalizePath(precondition.absolutePath), {
        absolutePath: precondition.absolutePath,
        identity: precondition.identity,
        bytes,
        contentHash: hashBytes(bytes),
        mode: verified.mode,
        readCount: 0,
      });
    } finally {
      await verified.close();
    }
  }

  return captures;
}

function installFilesystemInterceptors(): void {
  if (filesystemInterceptorsInstalled) return;
  filesystemInterceptorsInstalled = true;

  mutableFs.readFile = (async (...args: unknown[]): Promise<unknown> => {
    const capture = findCapture(args[0]);
    if (!capture) {
      return originalReadFile(...args);
    }

    const bytes = await readAndVerifyCapture(capture);
    capture.readCount += 1;
    await triggerPreconditionCaptureHook();
    return encodeReadResult(bytes, args[1]);
  }) as typeof mutableFs.readFile;

  mutableFs.copyFile = (async (...args: unknown[]): Promise<void> => {
    const capture = findCapture(args[0]);
    if (!capture || typeof args[1] !== 'string') {
      await originalCopyFile(...args);
      return;
    }

    const destination = args[1];
    await writeFile(destination, capture.bytes);
    await chmod(destination, capture.mode).catch(() => undefined);

    const context = executionContext.getStore();
    if (!context) return;
    context.backupCount += 1;
    if (
      !context.backupHookComplete
      && context.backupCount >= context.captures.size
    ) {
      context.backupHookComplete = true;
      await context.hooks?.afterTransactionBackup?.({
        backupRoot: path.dirname(destination),
      });
    }
  }) as typeof mutableFs.copyFile;
}

async function readAndVerifyCapture(capture: CapturedFile): Promise<Buffer> {
  const verified = await openVerifiedRegularFile(capture.absolutePath);
  try {
    if (!sameFileIdentity(capture.identity, verified.identity)) {
      throw new Error(`Operation precondition identity changed for ${capture.absolutePath}`);
    }
    const bytes = await verified.readBuffer();
    if (hashBytes(bytes) !== capture.contentHash) {
      throw new Error(`Operation precondition content changed for ${capture.absolutePath}`);
    }
    return bytes;
  } finally {
    await verified.close();
  }
}

async function triggerPreconditionCaptureHook(): Promise<void> {
  const context = executionContext.getStore();
  if (!context || context.preconditionHookComplete || context.captures.size === 0) return;
  if ([...context.captures.values()].some((capture) => capture.readCount < 2)) return;
  context.preconditionHookComplete = true;
  await context.hooks?.afterPreconditionCapture?.();
}

function findCapture(value: unknown): CapturedFile | undefined {
  if (typeof value !== 'string') return undefined;
  return executionContext.getStore()?.captures.get(normalizePath(value));
}

function encodeReadResult(bytes: Buffer, options: unknown): Buffer | string {
  const encoding = typeof options === 'string'
    ? options
    : options && typeof options === 'object' && 'encoding' in options
      ? (options as { encoding?: unknown }).encoding
      : undefined;
  return typeof encoding === 'string' ? bytes.toString(encoding as BufferEncoding) : Buffer.from(bytes);
}

function stripSecurityHooks(options: ExecuteOptions): core.ExecuteOptions {
  const { securityHooks: _securityHooks, ...coreOptions } = options;
  return coreOptions;
}

function assertContentHash(precondition: PathPrecondition, bytes: Buffer): void {
  const actual = crypto
    .createHash('sha256')
    .update('file')
    .update('\0')
    .update(bytes.toString('utf8'))
    .digest('hex');
  if (actual !== precondition.hash) {
    throw new Error(`Operation precondition content changed for ${precondition.absolutePath}`);
  }
}

function hashBytes(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizePath(value: string): string {
  return path.resolve(value);
}
