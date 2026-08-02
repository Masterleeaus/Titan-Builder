import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function resolveContainedPackageFile(
  packageRoot: string,
  relativePath: string,
): Promise<string> {
  if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw new Error(`Skill asset must be a non-empty relative path: ${relativePath}`);
  }

  const canonicalRoot = await realpath(packageRoot);
  const candidate = path.resolve(canonicalRoot, relativePath);
  assertContained(canonicalRoot, candidate, relativePath);

  const relative = path.relative(canonicalRoot, candidate);
  let current = canonicalRoot;
  let finalMetadata;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      finalMetadata = await lstat(current);
    } catch (error) {
      throw new Error(
        `Unable to read skill asset ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (finalMetadata.isSymbolicLink()) {
      throw new Error(`Skill asset contains a symbolic link or junction: ${relativePath}`);
    }
  }

  if (!finalMetadata?.isFile()) {
    throw new Error(`Skill asset must be a regular file: ${relativePath}`);
  }

  const canonicalCandidate = await realpath(candidate);
  assertContained(canonicalRoot, canonicalCandidate, relativePath);
  return canonicalCandidate;
}

function assertContained(root: string, candidate: string, originalPath: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Skill asset ${originalPath} escapes its package boundary.`);
  }
}
