import crypto from 'node:crypto';
import { constants as fsConstants, type Stats } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { canonicalizeProjectRoot, isPathInsideProject } from './project-path.js';

const INTERNAL_STATE_DIRECTORY = '.openbrowser';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const NO_FOLLOW = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);

interface FilesystemIdentity {
  dev: number;
  ino: number;
}

export interface ProjectInternalState {
  readonly projectRoot: string;
  readonly stateRoot: string;
  ensureDirectory(relativePath: string): Promise<string>;
  fileExists(relativePath: string): Promise<boolean>;
  readBuffer(relativePath: string): Promise<Buffer>;
  readText(relativePath: string): Promise<string>;
  readJson<T>(relativePath: string): Promise<T>;
  writeBuffer(relativePath: string, content: Uint8Array): Promise<void>;
  writeText(relativePath: string, content: string): Promise<void>;
  writeJson(relativePath: string, value: unknown): Promise<void>;
  ensureJson(relativePath: string, value: unknown): Promise<void>;
  copyFromFile(relativePath: string, sourcePath: string): Promise<void>;
  removeTree(relativePath: string): Promise<void>;
}

export async function openProjectInternalState(
  projectRoot: string,
): Promise<ProjectInternalState> {
  const canonicalRoot = await canonicalizeProjectRoot(projectRoot);
  const projectMetadata = await lstat(canonicalRoot);
  assertOwned(projectMetadata, 'project root');
  const projectIdentity = identityOf(projectMetadata);
  const stateRoot = path.join(canonicalRoot, INTERNAL_STATE_DIRECTORY);
  const stateMetadata = await ensurePrivateDirectory(
    stateRoot,
    projectMetadata.dev,
    'internal state root',
  );
  const stateIdentity = identityOf(stateMetadata);

  async function assertAuthority(): Promise<void> {
    const currentProject = await lstat(canonicalRoot);
    assertDirectory(currentProject, 'project root');
    assertOwned(currentProject, 'project root');
    assertIdentity(currentProject, projectIdentity, 'project root');

    const currentState = await lstat(stateRoot);
    assertPrivateDirectory(currentState, projectMetadata.dev, 'internal state root');
    assertIdentity(currentState, stateIdentity, 'internal state root');
    const canonicalState = await realpath(stateRoot);
    if (!samePath(canonicalState, stateRoot)) {
      throw new Error('Internal state root is redirected outside its bound identity');
    }
  }

  async function ensureDirectory(relativePath: string): Promise<string> {
    const segments = normalizeRelativePath(relativePath, true);
    await assertAuthority();
    let current = stateRoot;
    for (const segment of segments) {
      current = path.join(current, segment);
      await ensurePrivateDirectory(current, stateIdentity.dev, `internal state directory ${relativePath}`);
      const canonical = await realpath(current);
      if (!samePath(canonical, current) || !isPathInsideProject(stateRoot, canonical)) {
        throw new Error(`Internal state directory is redirected: ${relativePath}`);
      }
    }
    await assertAuthority();
    return current;
  }

  async function resolveFile(
    relativePath: string,
    options: { requireExisting: boolean; createParent: boolean },
  ): Promise<string> {
    const segments = normalizeRelativePath(relativePath, false);
    const normalized = segments.join(path.sep);
    const parentRelative = path.dirname(normalized);
    const parent = options.createParent
      ? await ensureDirectory(parentRelative === '.' ? '' : parentRelative)
      : await resolveDirectory(parentRelative === '.' ? '' : parentRelative);
    const candidate = path.join(parent, path.basename(normalized));
    assertContained(stateRoot, candidate, relativePath);

    try {
      const metadata = await lstat(candidate);
      await validatePrivateFile(candidate, metadata, stateIdentity.dev, relativePath);
      return candidate;
    } catch (error) {
      if (isNotFound(error)) {
        if (options.requireExisting) {
          throw new Error(`Internal state file does not exist: ${relativePath}`, { cause: error });
        }
        return candidate;
      }
      throw error;
    }
  }

  async function resolveDirectory(relativePath: string): Promise<string> {
    const segments = normalizeRelativePath(relativePath, true);
    await assertAuthority();
    let current = stateRoot;
    for (const segment of segments) {
      current = path.join(current, segment);
      const metadata = await lstat(current);
      assertPrivateDirectory(metadata, stateIdentity.dev, `internal state directory ${relativePath}`);
      const canonical = await realpath(current);
      if (!samePath(canonical, current) || !isPathInsideProject(stateRoot, canonical)) {
        throw new Error(`Internal state directory is redirected: ${relativePath}`);
      }
    }
    return current;
  }

  async function fileExists(relativePath: string): Promise<boolean> {
    try {
      await resolveFile(relativePath, { requireExisting: true, createParent: false });
      return true;
    } catch (error) {
      if (isNotFound(error) || (error instanceof Error && /does not exist/u.test(error.message))) {
        return false;
      }
      throw error;
    }
  }

  async function readBuffer(relativePath: string): Promise<Buffer> {
    await assertAuthority();
    const filePath = await resolveFile(relativePath, {
      requireExisting: true,
      createParent: false,
    });
    const before = await lstat(filePath);
    await validatePrivateFile(filePath, before, stateIdentity.dev, relativePath);
    const handle = await open(filePath, fsConstants.O_RDONLY | NO_FOLLOW);
    try {
      const opened = await handle.stat();
      assertPrivateFile(opened, stateIdentity.dev, relativePath);
      assertIdentity(opened, identityOf(before), `internal state file ${relativePath}`);
      const content = await handle.readFile();
      const after = await handle.stat();
      assertIdentity(after, identityOf(opened), `internal state file ${relativePath}`);
      await assertAuthority();
      return content;
    } finally {
      await handle.close();
    }
  }

  async function readText(relativePath: string): Promise<string> {
    return (await readBuffer(relativePath)).toString('utf8');
  }

  async function readJson<T>(relativePath: string): Promise<T> {
    return JSON.parse(await readText(relativePath)) as T;
  }

  async function writeBuffer(relativePath: string, content: Uint8Array): Promise<void> {
    await assertAuthority();
    let target = await resolveFile(relativePath, {
      requireExisting: false,
      createParent: true,
    });
    const parentRelative = path.dirname(normalizeRelativePath(relativePath, false).join(path.sep));
    const tempRelative = path.join(
      parentRelative === '.' ? '' : parentRelative,
      `.${path.basename(target)}.${crypto.randomUUID()}.tmp`,
    );
    const temporary = await resolveFile(tempRelative, {
      requireExisting: false,
      createParent: true,
    });
    const handle = await open(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
      PRIVATE_FILE_MODE,
    );
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await chmod(temporary, PRIVATE_FILE_MODE);
      await assertAuthority();
      await resolveDirectory(parentRelative === '.' ? '' : parentRelative);
      target = await resolveFile(relativePath, {
        requireExisting: false,
        createParent: false,
      });
      await validatePrivateFile(
        temporary,
        await lstat(temporary),
        stateIdentity.dev,
        tempRelative,
      );
      await rename(temporary, target);
      await validatePrivateFile(
        target,
        await lstat(target),
        stateIdentity.dev,
        relativePath,
      );
      await chmod(target, PRIVATE_FILE_MODE);
      await assertAuthority();
    } catch (error) {
      await removeTemporaryFile(temporary, stateIdentity.dev).catch(() => undefined);
      throw error;
    }
  }

  async function writeText(relativePath: string, content: string): Promise<void> {
    await writeBuffer(relativePath, Buffer.from(content, 'utf8'));
  }

  async function writeJson(relativePath: string, value: unknown): Promise<void> {
    await writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  async function ensureJson(relativePath: string, value: unknown): Promise<void> {
    if (!(await fileExists(relativePath))) {
      await writeJson(relativePath, value);
    }
  }

  async function copyFromFile(relativePath: string, sourcePath: string): Promise<void> {
    const source = await open(sourcePath, fsConstants.O_RDONLY | NO_FOLLOW);
    try {
      const metadata = await source.stat();
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`Rollback source is not a regular file: ${sourcePath}`);
      }
      await writeBuffer(relativePath, await source.readFile());
    } finally {
      await source.close();
    }
  }

  async function removeTree(relativePath: string): Promise<void> {
    const segments = normalizeRelativePath(relativePath, false);
    const normalized = segments.join(path.sep);
    await assertAuthority();
    const candidate = path.join(stateRoot, normalized);
    assertContained(stateRoot, candidate, relativePath);
    await removeValidatedNode(candidate, stateIdentity.dev);
    await assertAuthority();
  }

  return {
    projectRoot: canonicalRoot,
    stateRoot,
    ensureDirectory,
    fileExists,
    readBuffer,
    readText,
    readJson,
    writeBuffer,
    writeText,
    writeJson,
    ensureJson,
    copyFromFile,
    removeTree,
  };
}

async function ensurePrivateDirectory(
  directoryPath: string,
  expectedDevice: number,
  label: string,
): Promise<Stats> {
  let metadata: Stats;
  try {
    metadata = await lstat(directoryPath);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await mkdir(directoryPath, { mode: PRIVATE_DIRECTORY_MODE });
    metadata = await lstat(directoryPath);
  }
  assertPrivateDirectory(metadata, expectedDevice, label);
  await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
  return metadata;
}

function assertPrivateDirectory(metadata: Stats, expectedDevice: number, label: string): void {
  assertDirectory(metadata, label);
  if (metadata.isSymbolicLink()) {
    throw new Error(`${label} is a symbolic link or junction`);
  }
  assertOwned(metadata, label);
  if (metadata.dev !== expectedDevice) {
    throw new Error(`${label} crosses a mounted or redirected filesystem boundary`);
  }
}

function assertDirectory(metadata: Stats, label: string): void {
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symbolic link or junction`);
  }
}

async function validatePrivateFile(
  filePath: string,
  metadata: Stats,
  expectedDevice: number,
  label: string,
): Promise<void> {
  assertPrivateFile(metadata, expectedDevice, label);
  const canonical = await realpath(filePath);
  if (!samePath(canonical, filePath)) {
    throw new Error(`Internal state file is redirected: ${label}`);
  }
  await chmod(filePath, PRIVATE_FILE_MODE);
}

function assertPrivateFile(metadata: Stats, expectedDevice: number, label: string): void {
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Internal state must be a regular private file: ${label}`);
  }
  assertOwned(metadata, `internal state file ${label}`);
  if (metadata.dev !== expectedDevice) {
    throw new Error(`Internal state file crosses a mounted filesystem boundary: ${label}`);
  }
  if (metadata.nlink !== 1) {
    throw new Error(`Internal state file has an unsafe hardlink count: ${label}`);
  }
}

async function removeValidatedNode(nodePath: string, expectedDevice: number): Promise<void> {
  let metadata: Stats;
  try {
    metadata = await lstat(nodePath);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }

  if (metadata.isSymbolicLink()) {
    throw new Error(`Internal state cleanup refuses a symbolic link or junction: ${nodePath}`);
  }
  assertOwned(metadata, `internal state cleanup target ${nodePath}`);
  if (metadata.dev !== expectedDevice) {
    throw new Error(`Internal state cleanup refuses a mounted redirect: ${nodePath}`);
  }

  if (metadata.isFile()) {
    if (metadata.nlink !== 1) {
      throw new Error(`Internal state cleanup refuses a hardlinked file: ${nodePath}`);
    }
    await unlink(nodePath);
    return;
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Internal state cleanup refuses a non-file target: ${nodePath}`);
  }

  const originalIdentity = identityOf(metadata);
  for (const name of await readdir(nodePath)) {
    await removeValidatedNode(path.join(nodePath, name), expectedDevice);
  }
  const current = await lstat(nodePath);
  assertIdentity(current, originalIdentity, `internal state cleanup directory ${nodePath}`);
  await rmdir(nodePath);
}

async function removeTemporaryFile(filePath: string, expectedDevice: number): Promise<void> {
  const metadata = await lstat(filePath);
  assertPrivateFile(metadata, expectedDevice, filePath);
  await unlink(filePath);
}

function normalizeRelativePath(relativePath: string, allowRoot: boolean): string[] {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid internal state path: ${relativePath}`);
  }
  const normalized = relativePath.normalize('NFKC');
  if (/^[A-Za-z]:[\\/]/u.test(normalized) || normalized.startsWith('\\\\')) {
    throw new Error(`Invalid internal state path: ${relativePath}`);
  }
  const segments = normalized.split(/[\\/]+/u).filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Internal state path traversal is not allowed: ${relativePath}`);
  }
  if (!allowRoot && segments.length === 0) {
    throw new Error('Internal state file path must not be empty');
  }
  return segments;
}

function assertContained(root: string, candidate: string, originalPath: string): void {
  if (!isPathInsideProject(root, candidate)) {
    throw new Error(`Internal state path escapes its authority: ${originalPath}`);
  }
}

function assertOwned(metadata: Stats, label: string): void {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') return;
  if (metadata.uid !== process.getuid()) {
    throw new Error(`${label} is not owned by the current user`);
  }
}

function identityOf(metadata: Stats): FilesystemIdentity {
  return { dev: metadata.dev, ino: metadata.ino };
}

function assertIdentity(metadata: Stats, expected: FilesystemIdentity, label: string): void {
  if (metadata.dev !== expected.dev || metadata.ino !== expected.ino) {
    throw new Error(`${label} changed filesystem identity`);
  }
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
