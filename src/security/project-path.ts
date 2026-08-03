import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export type ExpectedPathType = 'file' | 'directory';

const RESERVED_VCS_METADATA_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '_darcs',
  '.bzr',
  '.fslckout',
  '.fossil-settings',
  '_fossil_',
  '.jj',
  '.pijul',
  '.sl',
  '_mtn',
  '.mtn',
  '.arch-ids',
  'cvs',
]);

export interface ResolveProjectPathOptions {
  requireExisting?: boolean;
  expectedType?: ExpectedPathType;
}

export async function canonicalizeProjectRoot(projectRoot: string): Promise<string> {
  const resolved = path.resolve(projectRoot);
  let canonical: string;
  try {
    canonical = await realpath(resolved);
  } catch (error) {
    throw new Error(`Project root does not exist or cannot be resolved: ${resolved}`, { cause: error });
  }

  const metadata = await lstat(canonical);
  if (!metadata.isDirectory()) {
    throw new Error(`Project root must be a directory: ${canonical}`);
  }

  return canonical;
}

export async function resolveProjectPath(
  projectRoot: string,
  targetPath: string,
  options: ResolveProjectPathOptions = {},
): Promise<string> {
  if (!targetPath || targetPath.includes('\0')) {
    throw new Error('Project path must be a non-empty path without null bytes');
  }

  assertNotReservedVcsPath(targetPath);
  assertNotWindowsSpecialPath(targetPath);

  const root = await canonicalizeProjectRoot(projectRoot);
  const candidate = path.resolve(root, targetPath);
  assertContained(root, candidate, targetPath);

  const relative = path.relative(root, candidate);
  const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
  let current = root;
  let existingTarget = true;

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Project path contains a symbolic link or junction: ${current}`);
      }
    } catch (error) {
      if (isNotFound(error)) {
        existingTarget = false;
        break;
      }
      throw error;
    }
  }

  if (!existingTarget) {
    if (options.requireExisting) {
      throw new Error(`Project path does not exist: ${targetPath}`);
    }

    const existingAncestor = path.dirname(current);
    const canonicalAncestor = await realpath(existingAncestor);
    assertContained(root, canonicalAncestor, targetPath);
    return candidate;
  }

  const canonicalTarget = await realpath(candidate);
  assertContained(root, canonicalTarget, targetPath);

  if (options.expectedType) {
    const metadata = await lstat(canonicalTarget);
    const matches = options.expectedType === 'directory'
      ? metadata.isDirectory()
      : metadata.isFile();
    if (!matches) {
      throw new Error(`Project path must be a ${options.expectedType}: ${targetPath}`);
    }
  }

  return canonicalTarget;
}

export function isPathInsideProject(projectRoot: string, targetPath: string): boolean {
  const relative = path.relative(projectRoot, targetPath);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function assertNoReservedVcsMetadata(targetPath: string): void {
  const normalizedPath = targetPath.normalize('NFKC');
  const segments = normalizedPath.split(/[\\/]+/u).filter(Boolean);

  for (const segment of segments) {
    const canonicalSegment = segment.replace(/[ .]+$/u, '').toLocaleLowerCase('en-US');
    if (RESERVED_VCS_METADATA_NAMES.has(canonicalSegment)) {
      throw new Error(`Project path targets reserved version-control metadata: ${targetPath}`);
    }
  }
}

function assertContained(projectRoot: string, targetPath: string, originalPath: string): void {
  if (!isPathInsideProject(projectRoot, targetPath)) {
    throw new Error(`Path escapes project root: ${originalPath}`);
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

const VCS_RESERVED_PREFIXES = ['.git', '.hg', '.svn', '.fossil', '.bzr', '.darcs'];
const OPENBROWSER_RESERVED = '.openbrowser';

export async function isReservedPath(
  projectRoot: string,
  absolutePath: string,
): Promise<boolean> {
  const relative = path.relative(projectRoot, absolutePath);
  const normalized = relative.replace(/\\/g, '/');

  if (isVcsReservedPath(normalized)) {
    return true;
  }

  if (normalized === OPENBROWSER_RESERVED || normalized.startsWith(`${OPENBROWSER_RESERVED}/`)) {
    return true;
  }

  const segments = normalized.split('/').filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (isVcsReservedName(segment)) {
      return true;
    }
  }

  return false;
}

function isVcsReservedPath(normalizedPath: string): boolean {
  for (const prefix of VCS_RESERVED_PREFIXES) {
    const lowerPath = normalizedPath.toLowerCase();
    const lowerPrefix = prefix.toLowerCase();

    if (lowerPath === lowerPrefix || lowerPath.startsWith(`${lowerPrefix}/`)) {
      return true;
    }

    if (normalizedPath === '.gitfile' || normalizedPath.startsWith('.gitfile/')) {
      return true;
    }
  }

  return false;
}

function isVcsReservedName(name: string): boolean {
  const lower = name.toLowerCase();

  const directoryReserved = [
    '.git', '.gitmodules', '.gitattributes', '.gitignore',
    '.hg', '.hgignore', '.hgsub',
    '.svn', '.cvs', '.fossil', '.bzr', '.darcs',
  ];

  for (const reserved of directoryReserved) {
    if (lower === reserved.toLowerCase() || lower === `${reserved.toLowerCase()}.file`) {
      return true;
    }
  }

  return false;
}
