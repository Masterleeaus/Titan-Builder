import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';
import { canonicalizeProjectRoot, isPathInsideProject } from './project-path.js';

const OPENBROWSER_STATE_DIRECTORY = '.openbrowser';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const NO_FOLLOW = typeof fsConstants.O_NOFOLLOW === 'number'
  ? fsConstants.O_NOFOLLOW
  : 0;

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
    assertSafeStateFile(candidate, metadata, authority.stateIdentity.device);
    const canonical = await realpath(candidate);
    if (canonical !== candidate) {
      throw unsafeStateError(candidate, 'resolves through a symbolic link, junction, or redirect');
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  await assertAuthorityIdentity(authority);
  return candidate;
}

export async function readOpenBrowserStateFile(
  projectRoot: string,
  relativeFile: string,
  encoding: BufferEncoding = 'utf8',
): Promise<string> {
  const filePath = await resolveOpenBrowserStateFile(projectRoot, relativeFile);
  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | NO_FOLLOW);
    const metadata = await handle.stat();
    const authority = await readTrustedStateRoot(projectRoot);
    assertSafeStateFile(filePath, metadata, authority.stateIdentity.device);
    await assertAuthorityIdentity(authority);
    return handle.readFile({ encoding });
  } finally {
    await handle?.close();
  }
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

async function ensureTrustedStateRoot(projectRoot: string): Promise<TrustedStateRoot> {
  const canonicalProjectRoot = await canonicalizeProjectRoot(projectRoot);
  const projectMetadata = await lstat(canonicalProjectRoot);
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
  if (canonical !== directoryPath) {
    throw unsafeStateError(label, 'is a symbolic link, junction, reparse point, or redirect');
  }
  if (process.platform !== 'win32') await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
}

function assertRealDirectory(
  directoryPath: string,
  metadata: Awaited<ReturnType<typeof lstat>>,
  expectedDevice: string,
  label = directoryPath,
): void {
  if (metadata.isSymbolicLink()) {
    throw unsafeStateError(label, 'is a symbolic link, junction, reparse point, or redirect');
  }
  if (!metadata.isDirectory()) {
    throw unsafeStateError(label, 'is not a real directory');
  }
  if (identityOf(metadata).device !== expectedDevice) {
    throw unsafeStateError(label, 'crosses a filesystem or mount redirect');
  }
}

function assertSafeStateFile(
  filePath: string,
  metadata: Awaited<ReturnType<typeof lstat>>,
  expectedDevice: string,
): void {
  if (metadata.isSymbolicLink()) {
    throw unsafeStateError(filePath, 'is a symbolic link, junction, reparse point, or redirect');
  }
  if (!metadata.isFile()) {
    throw unsafeStateError(filePath, 'is not a regular file');
  }
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

function normalizeStatePath(value: string, allowEmpty: boolean): string[] {
  const raw = String(value ?? '');
  if (raw.includes('\0')) throw new Error('OpenBrowser state path contains a null byte');
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/u.test(raw)) {
    throw new Error(`OpenBrowser state path must be relative: ${raw}`);
  }

  const normalized = path.normalize(raw || '.');
  const segments = normalized === '.'
    ? []
    : normalized.split(path.sep).filter(Boolean);
  if (segments.some((segment) => segment === '..' || segment === '.')) {
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

function identityOf(metadata: Awaited<ReturnType<typeof lstat>>): FilesystemIdentity {
  return {
    device: String(metadata.dev),
    inode: String(metadata.ino),
  };
}

function sameIdentity(left: FilesystemIdentity, right: FilesystemIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
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
