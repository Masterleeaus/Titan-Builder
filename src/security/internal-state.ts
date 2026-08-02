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
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { canonicalizeProjectRoot, isPathInsideProject } from './project-path.js';

const OPENBROWSER_STATE_DIRECTORY = '.openbrowser';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const NO_FOLLOW = process.platform === 'win32'
  ? 0
  : (fsConstants.O_NOFOLLOW ?? 0);

interface FilesystemIdentity {
  device: string;
  inode: string;
}

interface TrustedStateRoot {
  projectRoot: string;
  stateRoot: string;
  projectIdentity: FilesystemIdentity;
  stateIdentity: FilesystemIdentity;
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
  const authority = await ensureTrustedStateRoot(projectRoot);

  return {
    projectRoot: authority.projectRoot,
    stateRoot: authority.stateRoot,
    ensureDirectory: (relativePath) =>
      ensureOpenBrowserStateDirectory(authority.projectRoot, relativePath),
    async fileExists(relativePath) {
      try {
        const filePath = await resolveOpenBrowserStateFile(authority.projectRoot, relativePath);
        await lstat(filePath);
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },
    readBuffer: (relativePath) =>
      readOpenBrowserStateBuffer(authority.projectRoot, relativePath),
    readText: (relativePath) =>
      readOpenBrowserStateFile(authority.projectRoot, relativePath),
    async readJson<T>(relativePath: string): Promise<T> {
      return JSON.parse(
        await readOpenBrowserStateFile(authority.projectRoot, relativePath),
      ) as T;
    },
    async writeBuffer(relativePath, content) {
      await writeOpenBrowserStateFile(authority.projectRoot, relativePath, content);
    },
    async writeText(relativePath, content) {
      await writeOpenBrowserStateFile(authority.projectRoot, relativePath, content);
    },
    async writeJson(relativePath, value) {
      await writeOpenBrowserStateFile(
        authority.projectRoot,
        relativePath,
        `${JSON.stringify(value, null, 2)}\n`,
      );
    },
    async ensureJson(relativePath, value) {
      if (!(await this.fileExists(relativePath))) {
        await this.writeJson(relativePath, value);
      }
    },
    async copyFromFile(relativePath, sourcePath) {
      let handle: FileHandle | undefined;
      try {
        handle = await open(sourcePath, fsConstants.O_RDONLY | NO_FOLLOW);
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          throw new Error(`Rollback source is not a regular file: ${sourcePath}`);
        }
        await writeOpenBrowserStateFile(
          authority.projectRoot,
          relativePath,
          await handle.readFile(),
        );
      } finally {
        await handle?.close();
      }
    },
    async removeTree(relativePath) {
      await removeOpenBrowserStateTree(authority.projectRoot, relativePath);
    },
  };
}

export async function ensureOpenBrowserStateDirectory(
  projectRoot: string,
  relativeDirectory = '',
): Promise<string> {
  const authority = await ensureTrustedStateRoot(projectRoot);
  const segments = normalizeStatePath(relativeDirectory, true);
  let current = authority.stateRoot;

  for (const segment of segments) {
    current = path.join(current, segment);
    await ensurePrivateRealDirectory(current, authority.stateIdentity.device, segment);
  }

  await assertAuthorityIdentity(authority);
  return current;
}

export async function resolveOpenBrowserStateFile(
  projectRoot: string,
  relativeFile: string,
): Promise<string> {
  const segments = normalizeStatePath(relativeFile, false);
  const fileName = segments.at(-1);
  if (!fileName) throw new Error('OpenBrowser state file path is required');

  const parent = await ensureOpenBrowserStateDirectory(
    projectRoot,
    segments.slice(0, -1).join(path.sep),
  );
  const authority = await readTrustedStateRoot(projectRoot);
  const candidate = path.join(parent, fileName);
  assertContained(authority.stateRoot, candidate, relativeFile);

  try {
    const metadata = await lstat(candidate);
    await validateSafeStateFile(candidate, metadata, authority.stateIdentity.device);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  await assertAuthorityIdentity(authority);
  return candidate;
}

export async function readOpenBrowserStateBuffer(
  projectRoot: string,
  relativeFile: string,
): Promise<Buffer> {
  const filePath = await resolveOpenBrowserStateFile(projectRoot, relativeFile);
  const before = await lstat(filePath);
  const authority = await readTrustedStateRoot(projectRoot);
  await validateSafeStateFile(filePath, before, authority.stateIdentity.device);

  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | NO_FOLLOW);
    const opened = await handle.stat();
    assertSafeStateFile(filePath, opened, authority.stateIdentity.device);
    if (!sameIdentity(identityOf(opened), identityOf(before))) {
      throw unsafeStateError(filePath, 'changed identity before it was opened');
    }
    const content = await handle.readFile();
    const after = await handle.stat();
    if (!sameIdentity(identityOf(after), identityOf(opened))) {
      throw unsafeStateError(filePath, 'changed identity while it was being read');
    }
    await assertAuthorityIdentity(authority);
    return content;
  } finally {
    await handle?.close();
  }
}

export async function readOpenBrowserStateFile(
  projectRoot: string,
  relativeFile: string,
  encoding: BufferEncoding = 'utf8',
): Promise<string> {
  return (await readOpenBrowserStateBuffer(projectRoot, relativeFile)).toString(encoding);
}

export async function writeOpenBrowserStateFile(
  projectRoot: string,
  relativeFile: string,
  content: string | Uint8Array,
): Promise<string> {
  const targetPath = await resolveOpenBrowserStateFile(projectRoot, relativeFile);
  const authority = await readTrustedStateRoot(projectRoot);
  const relative = path.relative(authority.stateRoot, targetPath);
  const parentRelative = path.dirname(relative);
  const parent = await ensureOpenBrowserStateDirectory(
    projectRoot,
    parentRelative === '.' ? '' : parentRelative,
  );
  const tempName = `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const tempPath = path.join(parent, tempName);
  let handle: FileHandle | undefined;

  try {
    handle = await open(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
      PRIVATE_FILE_MODE,
    );
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;

    await resolveOpenBrowserStateFile(projectRoot, relative);
    await assertAuthorityIdentity(authority);
    await validateSafeStateFile(
      tempPath,
      await lstat(tempPath),
      authority.stateIdentity.device,
    );
    await rename(tempPath, targetPath);
    if (process.platform !== 'win32') await chmod(targetPath, PRIVATE_FILE_MODE);

    const finalPath = await resolveOpenBrowserStateFile(projectRoot, relative);
    await assertAuthorityIdentity(authority);
    return finalPath;
  } finally {
    await handle?.close();
    await unlink(tempPath).catch((error: unknown) => {
      if (!isNotFound(error)) throw error;
    });
  }
}

export async function removeOpenBrowserStateTree(
  projectRoot: string,
  relativePath: string,
): Promise<void> {
  const segments = normalizeStatePath(relativePath, false);
  const authority = await readTrustedStateRoot(projectRoot);
  let parent = authority.stateRoot;

  for (const segment of segments.slice(0, -1)) {
    parent = path.join(parent, segment);
    const metadata = await lstat(parent);
    assertRealDirectory(parent, metadata, authority.stateIdentity.device, segment);
    const canonical = await realpath(parent);
    if (!sameCanonicalPath(canonical, parent)) {
      throw unsafeStateError(parent, 'is redirected during cleanup');
    }
  }

  const candidate = path.join(parent, segments.at(-1) ?? '');
  assertContained(authority.stateRoot, candidate, relativePath);
  await removeValidatedNode(candidate, authority.stateIdentity.device);
  await assertAuthorityIdentity(authority);
}

async function ensureTrustedStateRoot(projectRoot: string): Promise<TrustedStateRoot> {
  const canonicalProjectRoot = await canonicalizeProjectRoot(projectRoot);
  const projectMetadata = await lstat(canonicalProjectRoot);
  assertOwned(projectMetadata, 'project root');
  const stateRoot = path.join(canonicalProjectRoot, OPENBROWSER_STATE_DIRECTORY);
  await ensurePrivateRealDirectory(
    stateRoot,
    identityOf(projectMetadata).device,
    OPENBROWSER_STATE_DIRECTORY,
  );

  const stateMetadata = await lstat(stateRoot);
  const authority: TrustedStateRoot = {
    projectRoot: canonicalProjectRoot,
    stateRoot,
    projectIdentity: identityOf(projectMetadata),
    stateIdentity: identityOf(stateMetadata),
  };
  await assertAuthorityIdentity(authority);
  return authority;
}

async function readTrustedStateRoot(projectRoot: string): Promise<TrustedStateRoot> {
  const canonicalProjectRoot = await canonicalizeProjectRoot(projectRoot);
  const projectMetadata = await lstat(canonicalProjectRoot);
  assertOwned(projectMetadata, 'project root');
  const stateRoot = path.join(canonicalProjectRoot, OPENBROWSER_STATE_DIRECTORY);
  const stateMetadata = await lstat(stateRoot);
  assertRealDirectory(stateRoot, stateMetadata, identityOf(projectMetadata).device);

  const authority: TrustedStateRoot = {
    projectRoot: canonicalProjectRoot,
    stateRoot,
    projectIdentity: identityOf(projectMetadata),
    stateIdentity: identityOf(stateMetadata),
  };
  await assertAuthorityIdentity(authority);
  return authority;
}

async function ensurePrivateRealDirectory(
  directoryPath: string,
  expectedDevice: string,
  label: string,
): Promise<void> {
  try {
    await mkdir(directoryPath, { mode: PRIVATE_DIRECTORY_MODE });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }

  const metadata = await lstat(directoryPath);
  assertRealDirectory(directoryPath, metadata, expectedDevice, label);
  const canonical = await realpath(directoryPath);
  if (!sameCanonicalPath(canonical, directoryPath)) {
    throw unsafeStateError(label, 'is a symbolic link, junction, reparse point, or redirect');
  }
  if (process.platform !== 'win32') await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
}

function assertRealDirectory(
  directoryPath: string,
  metadata: Stats,
  expectedDevice: string,
  label = directoryPath,
): void {
  if (metadata.isSymbolicLink()) {
    throw unsafeStateError(label, 'is a symbolic link, junction, reparse point, or redirect');
  }
  if (!metadata.isDirectory()) {
    throw unsafeStateError(label, 'is not a real directory');
  }
  assertOwned(metadata, label);
  if (identityOf(metadata).device !== expectedDevice) {
    throw unsafeStateError(label, 'crosses a filesystem or mount redirect');
  }
}

async function validateSafeStateFile(
  filePath: string,
  metadata: Stats,
  expectedDevice: string,
): Promise<void> {
  assertSafeStateFile(filePath, metadata, expectedDevice);
  const canonical = await realpath(filePath);
  if (!sameCanonicalPath(canonical, filePath)) {
    throw unsafeStateError(filePath, 'resolves through a symbolic link, junction, or redirect');
  }
  if (process.platform !== 'win32') await chmod(filePath, PRIVATE_FILE_MODE);
}

function assertSafeStateFile(
  filePath: string,
  metadata: Stats,
  expectedDevice: string,
): void {
  if (metadata.isSymbolicLink()) {
    throw unsafeStateError(filePath, 'is a symbolic link, junction, reparse point, or redirect');
  }
  if (!metadata.isFile()) {
    throw unsafeStateError(filePath, 'is not a regular file');
  }
  assertOwned(metadata, `internal state file ${filePath}`);
  if (identityOf(metadata).device !== expectedDevice) {
    throw unsafeStateError(filePath, 'crosses a filesystem or mount redirect');
  }
  if (metadata.nlink !== 1) {
    throw unsafeStateError(filePath, 'is an unsafe hardlink');
  }
}

async function assertAuthorityIdentity(authority: TrustedStateRoot): Promise<void> {
  const [projectMetadata, stateMetadata] = await Promise.all([
    lstat(authority.projectRoot),
    lstat(authority.stateRoot),
  ]);
  assertRealDirectory(
    authority.projectRoot,
    projectMetadata,
    authority.projectIdentity.device,
    'project root',
  );
  assertRealDirectory(
    authority.stateRoot,
    stateMetadata,
    authority.projectIdentity.device,
    OPENBROWSER_STATE_DIRECTORY,
  );
  if (!sameIdentity(identityOf(projectMetadata), authority.projectIdentity)) {
    throw unsafeStateError('project root', 'identity changed during the state operation');
  }
  if (!sameIdentity(identityOf(stateMetadata), authority.stateIdentity)) {
    throw unsafeStateError(OPENBROWSER_STATE_DIRECTORY, 'identity changed during the state operation');
  }
}

async function removeValidatedNode(nodePath: string, expectedDevice: string): Promise<void> {
  let metadata: Stats;
  try {
    metadata = await lstat(nodePath);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }

  if (metadata.isSymbolicLink()) {
    throw unsafeStateError(nodePath, 'cleanup refuses a symbolic link, junction, or redirect');
  }
  assertOwned(metadata, `internal state cleanup target ${nodePath}`);
  if (identityOf(metadata).device !== expectedDevice) {
    throw unsafeStateError(nodePath, 'cleanup refuses a mounted redirect');
  }

  if (metadata.isFile()) {
    if (metadata.nlink !== 1) {
      throw unsafeStateError(nodePath, 'cleanup refuses a hardlinked file');
    }
    await unlink(nodePath);
    return;
  }
  if (!metadata.isDirectory()) {
    throw unsafeStateError(nodePath, 'cleanup refuses a non-file target');
  }

  const originalIdentity = identityOf(metadata);
  for (const name of await readdir(nodePath)) {
    await removeValidatedNode(path.join(nodePath, name), expectedDevice);
  }
  const current = await lstat(nodePath);
  if (!sameIdentity(identityOf(current), originalIdentity)) {
    throw unsafeStateError(nodePath, 'cleanup target changed identity');
  }
  await rmdir(nodePath);
}

function normalizeStatePath(value: string, allowEmpty: boolean): string[] {
  const raw = String(value ?? '');
  if (raw.includes('\0')) throw new Error('OpenBrowser state path contains a null byte');
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/u.test(raw) || raw.startsWith('\\\\')) {
    throw new Error(`OpenBrowser state path must be relative: ${raw}`);
  }

  const portable = raw.normalize('NFKC').replaceAll('\\', '/');
  const normalized = path.posix.normalize(portable || '.');
  const segments = normalized === '.'
    ? []
    : normalized.split('/').filter(Boolean);
  if (
    normalized === '..'
    || normalized.startsWith('../')
    || segments.some((segment) => segment === '..' || segment === '.')
  ) {
    throw new Error(`OpenBrowser state path escapes the trusted state root: ${raw}`);
  }
  if (!allowEmpty && segments.length === 0) {
    throw new Error('OpenBrowser state file path is required');
  }
  return segments;
}

function assertContained(stateRoot: string, candidate: string, original: string): void {
  if (!isPathInsideProject(stateRoot, candidate)) {
    throw new Error(`OpenBrowser state path escapes the trusted state root: ${original}`);
  }
}

function assertOwned(metadata: Stats, label: string): void {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') return;
  if (metadata.uid !== process.getuid()) {
    throw unsafeStateError(label, 'is not owned by the current user');
  }
}

function identityOf(metadata: Stats): FilesystemIdentity {
  return {
    device: String(metadata.dev),
    inode: String(metadata.ino),
  };
}

function sameIdentity(left: FilesystemIdentity, right: FilesystemIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function sameCanonicalPath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  if (process.platform === 'win32') {
    return normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US');
  }
  return normalizedLeft === normalizedRight;
}

function unsafeStateError(target: string, reason: string): Error {
  return new Error(`Unsafe OpenBrowser state path ${target}: ${reason}`);
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}
