import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { canonicalizeProjectRoot, resolveProjectPath } from '../security/project-path.js';

export type RollbackPathKind = 'missing' | 'file' | 'directory';

export interface RollbackPathRecord {
  absolutePath: string;
  relativePath: string;
  backupPath?: string;
  kind: RollbackPathKind;
  hash: string;
  mode?: number;
  role: 'target' | 'parent';
}

export interface RollbackValidationContext {
  projectRoot: string;
  backupRoot: string;
  targets: RollbackPathRecord[];
  parents: RollbackPathRecord[];
}

export async function preflightRollback(
  projectRoot: string,
  backupRoot: string,
  snapshots: RollbackPathRecord[],
): Promise<RollbackValidationContext> {
  const canonicalRoot = await assertProjectIdentity(projectRoot);
  const canonicalBackupRoot = await validateBackupRoot(canonicalRoot, backupRoot);
  const targets = snapshots
    .filter((snapshot) => snapshot.role === 'target')
    .sort((left, right) => pathDepth(right.absolutePath) - pathDepth(left.absolutePath));
  const parents = snapshots
    .filter((snapshot) => snapshot.role === 'parent')
    .sort((left, right) => pathDepth(right.absolutePath) - pathDepth(left.absolutePath));

  for (const snapshot of [...targets, ...parents]) {
    await validateRollbackPath(canonicalRoot, snapshot);
    if (snapshot.backupPath) {
      await validateRollbackBackup(canonicalRoot, canonicalBackupRoot, snapshot);
    } else if (snapshot.kind === 'file') {
      throw new Error(`Missing rollback backup for ${snapshot.relativePath}`);
    }
  }

  return {
    projectRoot: canonicalRoot,
    backupRoot: canonicalBackupRoot,
    targets,
    parents,
  };
}

export async function restoreRollbackTarget(
  context: RollbackValidationContext,
  snapshot: RollbackPathRecord,
): Promise<void> {
  await assertProjectIdentity(context.projectRoot);

  if (snapshot.kind === 'missing') {
    const target = await validateRollbackPath(context.projectRoot, snapshot);
    await fs.remove(target);
    return;
  }

  if (snapshot.kind === 'directory') {
    let target = await validateRollbackPath(context.projectRoot, snapshot);
    if (await fs.pathExists(target)) {
      const current = await fs.lstat(target);
      if (current.isSymbolicLink()) {
        throw new Error(`Rollback target became a symbolic link or junction: ${snapshot.relativePath}`);
      }
      if (!current.isDirectory()) {
        target = await validateRollbackPath(context.projectRoot, snapshot);
        await fs.remove(target);
      }
    }
    await ensureValidatedParent(context.projectRoot, snapshot.relativePath);
    target = await validateRollbackPath(context.projectRoot, snapshot);
    await fs.ensureDir(target);
    await resolveProjectPath(context.projectRoot, snapshot.relativePath, {
      requireExisting: true,
      expectedType: 'directory',
    });
    return;
  }

  let backup = await validateRollbackBackup(
    context.projectRoot,
    context.backupRoot,
    snapshot,
  );
  let target = await validateRollbackPath(context.projectRoot, snapshot);
  await fs.remove(target);
  await ensureValidatedParent(context.projectRoot, snapshot.relativePath);
  target = await validateRollbackPath(context.projectRoot, snapshot);
  backup = await validateRollbackBackup(context.projectRoot, context.backupRoot, snapshot);
  await fs.copyFile(backup, target);
  const restored = await resolveProjectPath(context.projectRoot, snapshot.relativePath, {
    requireExisting: true,
    expectedType: 'file',
  });
  await assertFileHash(restored, snapshot.hash, `Restored rollback file ${snapshot.relativePath}`);
  if (snapshot.mode !== undefined) {
    await fs.chmod(restored, snapshot.mode);
  }
}

export async function restoreRollbackParent(
  context: RollbackValidationContext,
  snapshot: RollbackPathRecord,
): Promise<void> {
  await assertProjectIdentity(context.projectRoot);
  let target = await validateRollbackPath(context.projectRoot, snapshot);

  if (snapshot.kind === 'missing') {
    try {
      target = await validateRollbackPath(context.projectRoot, snapshot);
      await fs.rmdir(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') {
        throw error;
      }
    }
    return;
  }

  if (snapshot.kind !== 'directory') {
    throw new Error(`Rollback parent snapshot is not a directory: ${snapshot.relativePath}`);
  }

  await ensureValidatedParent(context.projectRoot, snapshot.relativePath);
  target = await validateRollbackPath(context.projectRoot, snapshot);
  await fs.ensureDir(target);
  await resolveProjectPath(context.projectRoot, snapshot.relativePath, {
    requireExisting: true,
    expectedType: 'directory',
  });
}

export async function removeRollbackBackup(
  context: RollbackValidationContext,
): Promise<void> {
  await assertProjectIdentity(context.projectRoot);
  const backupRoot = await validateBackupRoot(context.projectRoot, context.backupRoot);
  await fs.remove(backupRoot);
}

async function assertProjectIdentity(projectRoot: string): Promise<string> {
  const canonicalRoot = await canonicalizeProjectRoot(projectRoot);
  if (!sameFilesystemPath(canonicalRoot, projectRoot)) {
    throw new Error(
      `Rollback project root identity changed: expected ${projectRoot}, resolved ${canonicalRoot}`,
    );
  }
  return canonicalRoot;
}

async function validateRollbackPath(
  projectRoot: string,
  snapshot: RollbackPathRecord,
): Promise<string> {
  const expected = path.resolve(projectRoot, snapshot.relativePath);
  if (!sameFilesystemPath(expected, snapshot.absolutePath)) {
    throw new Error(`Rollback snapshot path does not match its project-relative path: ${snapshot.relativePath}`);
  }

  const resolved = await resolveProjectPath(projectRoot, snapshot.relativePath);
  if (!sameFilesystemPath(resolved, expected)) {
    throw new Error(`Rollback path escaped canonical project containment: ${snapshot.relativePath}`);
  }
  return resolved;
}

async function validateBackupRoot(projectRoot: string, backupRoot: string): Promise<string> {
  const relativePath = containedRelativePath(projectRoot, backupRoot, 'rollback backup root');
  const resolved = await resolveProjectPath(projectRoot, relativePath, {
    requireExisting: true,
    expectedType: 'directory',
  });
  if (!sameFilesystemPath(resolved, backupRoot)) {
    throw new Error('Rollback backup root changed canonical identity');
  }
  return resolved;
}

async function validateRollbackBackup(
  projectRoot: string,
  backupRoot: string,
  snapshot: RollbackPathRecord,
): Promise<string> {
  if (!snapshot.backupPath) {
    throw new Error(`Missing rollback backup for ${snapshot.relativePath}`);
  }

  const relativePath = containedRelativePath(projectRoot, snapshot.backupPath, 'rollback backup');
  const resolved = await resolveProjectPath(projectRoot, relativePath, {
    requireExisting: true,
    expectedType: 'file',
  });
  if (!sameFilesystemPath(resolved, snapshot.backupPath)) {
    throw new Error(`Rollback backup changed canonical identity for ${snapshot.relativePath}`);
  }
  containedRelativePath(backupRoot, resolved, 'rollback backup file');
  await assertFileHash(resolved, snapshot.hash, `Rollback backup for ${snapshot.relativePath}`);
  return resolved;
}

async function ensureValidatedParent(projectRoot: string, relativePath: string): Promise<void> {
  const parentRelative = path.dirname(relativePath);
  if (parentRelative === '.') {
    return;
  }
  let parent = await resolveProjectPath(projectRoot, parentRelative, { expectedType: 'directory' });
  await fs.ensureDir(parent);
  parent = await resolveProjectPath(projectRoot, parentRelative, {
    requireExisting: true,
    expectedType: 'directory',
  });
  if (!sameFilesystemPath(parent, path.resolve(projectRoot, parentRelative))) {
    throw new Error(`Rollback parent changed canonical identity: ${parentRelative}`);
  }
}

async function assertFileHash(
  absolutePath: string,
  expectedHash: string,
  label: string,
): Promise<void> {
  const stats = await fs.lstat(absolutePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file`);
  }
  const content = await fs.readFile(absolutePath, 'utf8');
  const actualHash = crypto
    .createHash('sha256')
    .update('file')
    .update('\0')
    .update(content)
    .digest('hex');
  if (actualHash !== expectedHash) {
    throw new Error(`${label} failed integrity validation`);
  }
}

function containedRelativePath(root: string, candidate: string, label: string): string {
  const relativePath = path.relative(root, candidate);
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`${label} is not contained by its expected root`);
  }
  return relativePath;
}

function sameFilesystemPath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function pathDepth(value: string): number {
  return value.split(path.sep).length;
}
