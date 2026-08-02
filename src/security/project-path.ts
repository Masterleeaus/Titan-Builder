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
  '.jj',
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

  assertNoReservedVcsMetadata(targetPath);

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
