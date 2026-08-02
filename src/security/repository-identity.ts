import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  open,
  realpath,
  type BigIntStats,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_CAPTURE_ATTEMPTS = 3;

export interface FilesystemIdentity {
  device: string;
  inode: string;
}

interface IndexIdentity extends FilesystemIdentity {
  size: string;
  modifiedNanoseconds: string;
  changedNanoseconds: string;
}

export interface FilesystemRepositoryIdentity {
  kind: 'filesystem';
  projectRoot: string;
  projectRootIdentity: FilesystemIdentity;
}

export interface GitRepositoryIdentity {
  kind: 'git';
  projectRoot: string;
  projectRootIdentity: FilesystemIdentity;
  repositoryRoot: string;
  worktreeIdentity: FilesystemIdentity;
  commonDir: string;
  commonDirIdentity: FilesystemIdentity;
  gitDir: string;
  gitDirIdentity: FilesystemIdentity;
  branch: string | null;
  head: string;
  indexPath: string;
  indexDigest: string;
  indexIdentity: IndexIdentity | null;
}

export type RepositoryIdentity =
  | FilesystemRepositoryIdentity
  | GitRepositoryIdentity;

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  missingExecutable: boolean;
}

interface IndexSnapshot {
  digest: string;
  identity: IndexIdentity | null;
}

export async function captureRepositoryIdentity(
  projectRoot: string,
): Promise<RepositoryIdentity> {
  const canonicalProjectRoot = await canonicalDirectory(projectRoot, 'project root');
  const projectRootIdentity = await readDirectoryIdentity(
    canonicalProjectRoot,
    'project root',
  );
  const inside = await runGit(canonicalProjectRoot, [
    'rev-parse',
    '--is-inside-work-tree',
  ]);

  if (inside.exitCode !== 0 || inside.stdout !== 'true') {
    if (inside.missingExecutable && await looksLikeGitRepository(canonicalProjectRoot)) {
      throw new Error('Git repository identity cannot be captured because git is unavailable');
    }
    return {
      kind: 'filesystem',
      projectRoot: canonicalProjectRoot,
      projectRootIdentity,
    };
  }

  for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS; attempt += 1) {
    const first = await captureGitIdentityOnce(
      canonicalProjectRoot,
      projectRootIdentity,
    );
    const second = await captureGitIdentityOnce(
      canonicalProjectRoot,
      projectRootIdentity,
    );
    if (sameRepositoryIdentity(first, second)) {
      return second;
    }
  }

  throw new Error('Repository identity changed while it was being captured');
}

export function sameRepositoryIdentity(
  left: RepositoryIdentity,
  right: RepositoryIdentity,
): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

export function repositoryIdentityDigest(identity: RepositoryIdentity): string {
  return crypto
    .createHash('sha256')
    .update(stableSerialize(identity))
    .digest('hex');
}

async function captureGitIdentityOnce(
  projectRoot: string,
  expectedProjectRootIdentity: FilesystemIdentity,
): Promise<GitRepositoryIdentity> {
  const currentProjectRootIdentity = await readDirectoryIdentity(
    projectRoot,
    'project root',
  );
  if (!sameFilesystemIdentity(currentProjectRootIdentity, expectedProjectRootIdentity)) {
    throw new Error('Project root identity changed while repository identity was captured');
  }

  const [repositoryRootValue, gitDirValue, commonDirValue, branchResult, headResult, indexPathValue] =
    await Promise.all([
      requireGitOutput(projectRoot, ['rev-parse', '--show-toplevel'], 'repository root'),
      requireGitOutput(projectRoot, ['rev-parse', '--absolute-git-dir'], 'git directory'),
      requireGitOutput(
        projectRoot,
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        'git common directory',
      ),
      runGit(projectRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
      runGit(projectRoot, ['rev-parse', '--verify', 'HEAD']),
      requireGitOutput(
        projectRoot,
        ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
        'git index path',
      ),
    ]);

  if (branchResult.exitCode !== 0 && branchResult.exitCode !== 1) {
    throw gitCommandError('symbolic branch', branchResult);
  }
  if (headResult.exitCode !== 0 || !headResult.stdout) {
    throw gitCommandError('HEAD commit', headResult);
  }

  const repositoryRoot = await canonicalDirectory(repositoryRootValue, 'repository root');
  const gitDir = await canonicalDirectory(gitDirValue, 'git directory');
  const commonDir = await canonicalDirectory(commonDirValue, 'git common directory');
  const indexPath = path.resolve(indexPathValue);
  const index = await readStableIndex(indexPath);

  const identity: GitRepositoryIdentity = {
    kind: 'git',
    projectRoot,
    projectRootIdentity: currentProjectRootIdentity,
    repositoryRoot,
    worktreeIdentity: await readDirectoryIdentity(repositoryRoot, 'repository worktree'),
    commonDir,
    commonDirIdentity: await readDirectoryIdentity(commonDir, 'git common directory'),
    gitDir,
    gitDirIdentity: await readDirectoryIdentity(gitDir, 'git directory'),
    branch: branchResult.exitCode === 0 ? requireText(branchResult.stdout, 'branch') : null,
    head: requireText(headResult.stdout, 'HEAD commit'),
    indexPath,
    indexDigest: index.digest,
    indexIdentity: index.identity,
  };

  const finalProjectRootIdentity = await readDirectoryIdentity(projectRoot, 'project root');
  if (!sameFilesystemIdentity(finalProjectRootIdentity, expectedProjectRootIdentity)) {
    throw new Error('Project root identity changed while repository identity was captured');
  }
  return identity;
}

async function readStableIndex(indexPath: string): Promise<IndexSnapshot> {
  let before: BigIntStats;
  try {
    before = await lstat(indexPath, { bigint: true });
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return { digest: 'missing', identity: null };
    }
    throw error;
  }

  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`Git index is not a regular file: ${indexPath}`);
  }
  if (before.size > BigInt(MAX_INDEX_BYTES)) {
    throw new Error(`Git index exceeds ${MAX_INDEX_BYTES} bytes: ${indexPath}`);
  }

  const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW;
  const handle = await open(indexPath, fsConstants.O_RDONLY | noFollow);
  try {
    const openedBefore = await handle.stat({ bigint: true });
    if (!sameFileState(before, openedBefore)) {
      throw new Error(`Git index changed before it could be opened safely: ${indexPath}`);
    }
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    if (!sameFileState(openedBefore, openedAfter)) {
      throw new Error(`Git index changed while it was being read: ${indexPath}`);
    }
    const after = await lstat(indexPath, { bigint: true });
    if (!sameFileState(openedAfter, after)) {
      throw new Error(`Git index path changed while it was being read: ${indexPath}`);
    }
    return {
      digest: crypto.createHash('sha256').update(bytes).digest('hex'),
      identity: toIndexIdentity(openedAfter),
    };
  } finally {
    await handle.close();
  }
}

async function canonicalDirectory(value: string, label: string): Promise<string> {
  const resolved = await realpath(path.resolve(requireText(value, label)));
  const metadata = await lstat(resolved, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is not a real directory: ${resolved}`);
  }
  return resolved;
}

async function readDirectoryIdentity(
  directory: string,
  label: string,
): Promise<FilesystemIdentity> {
  const metadata = await lstat(directory, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is not a real directory: ${directory}`);
  }
  return {
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
  };
}

async function requireGitOutput(
  cwd: string,
  args: string[],
  label: string,
): Promise<string> {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0 || !result.stdout) {
    throw gitCommandError(label, result);
  }
  return result.stdout;
}

async function runGit(cwd: string, args: string[]): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
      env: gitEnvironment(),
    });
    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
      missingExecutable: false,
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
    };
    return {
      stdout: String(failure.stdout ?? '').trim(),
      stderr: String(failure.stderr ?? failure.message ?? '').trim(),
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      missingExecutable: failure.code === 'ENOENT',
    };
  }
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR',
    'HOME',
    'USERPROFILE',
    'TMP',
    'TEMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
  ] as const;
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.GIT_PAGER = 'cat';
  environment.GIT_OPTIONAL_LOCKS = '0';
  return environment;
}

async function looksLikeGitRepository(projectRoot: string): Promise<boolean> {
  try {
    await lstat(path.join(projectRoot, '.git'));
    return true;
  } catch {
    return false;
  }
}

function sameFilesystemIdentity(
  left: FilesystemIdentity,
  right: FilesystemIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.isFile() === right.isFile()
  );
}

function toIndexIdentity(metadata: BigIntStats): IndexIdentity {
  return {
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    size: metadata.size.toString(),
    modifiedNanoseconds: metadata.mtimeNs.toString(),
    changedNanoseconds: metadata.ctimeNs.toString(),
  };
}

function gitCommandError(label: string, result: GitCommandResult): Error {
  const detail = result.stderr || result.stdout || `exit code ${result.exitCode}`;
  return new Error(`Unable to capture ${label}: ${detail}`);
}

function requireText(value: string, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    .join(',')}}`;
}

function isErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}
