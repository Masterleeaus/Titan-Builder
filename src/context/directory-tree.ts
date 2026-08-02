import path from 'node:path';
import { lstat, realpath, readdir } from 'node:fs/promises';
import fg from 'fast-glob';
import fs from 'fs-extra';
import { CONTEXT_IGNORE } from './file-context.js';
import { isPathInsideProject } from '../security/project-path.js';

const MAX_TREE_DEPTH = 10;
const MAX_TREE_ENTRIES = 200;

export interface ContextDirectory {
  path: string;
  relativePath: string;
  directories: string[];
  files: string[];
  fileCount: number;
  empty: boolean;
  treeText: string;
}

function shouldSkipDir(name: string): boolean {
  return CONTEXT_IGNORE.some((pattern) => {
    const stripped = pattern.replace(/\*\*/g, '').replace(/\//g, '').replace(/\*/g, '');
    return name === stripped || name.startsWith('.');
  });
}

export async function scanDirectoryTree(
  projectRoot: string,
  dirRef: string,
): Promise<ContextDirectory | null> {
  const normalizedRef = dirRef.replace(/\\/g, '/').replace(/\/$/, '');
  const resolved = path.resolve(projectRoot, normalizedRef);

  let rootCanonical: string;
  try {
    rootCanonical = await realpath(projectRoot);
  } catch {
    return null;
  }

  if (!isPathInsideProject(rootCanonical, resolved)) {
    return null;
  }

  let targetCanonical: string;
  try {
    targetCanonical = await realpath(resolved);
  } catch {
    return null;
  }

  if (!isPathInsideProject(rootCanonical, targetCanonical)) {
    return null;
  }

  const stat = await lstat(targetCanonical);
  if (!stat.isDirectory()) {
    return null;
  }

  const relativePath = path.relative(rootCanonical, targetCanonical).replace(/\\/g, '/');
  const treeLines: string[] = [];
  const directories: string[] = [];
  const files: string[] = [];

  await walkDirectory(rootCanonical, targetCanonical, relativePath, 0, treeLines, directories, files);

  const nestedFiles = await fg('**/*', {
    cwd: targetCanonical,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: CONTEXT_IGNORE,
  });

  for (const nestedFile of nestedFiles) {
    const candidateRef = path.posix.join(relativePath, nestedFile.replace(/\\/g, '/'));
    try {
      const safeFile = await resolveContextPath(root, candidateRef, {
        requireExisting: true,
        expectedType: 'file',
      });
      if (!files.includes(safeFile.relativePath)) {
        files.push(safeFile.relativePath);
      }
    } catch {
      // Ignore files that no longer resolve through the canonical project boundary.
    }
  }

  const fileCount = files.length;
  const treeText =
    treeLines.length > 0
      ? treeLines.join('\n')
      : `${relativePath || '.'}/ (empty — no files or subfolders)`;

  return {
    path: normalizedRef,
    relativePath,
    directories: [...new Set(directories)].sort(),
    files: [...new Set(files)].sort(),
    fileCount,
    empty: fileCount === 0 && directories.length === 0,
    treeText,
  };
}

async function walkDirectory(
  projectRoot: string,
  absoluteDir: string,
  relativeDir: string,
  depth: number,
  treeLines: string[],
  directories: string[],
  files: string[],
): Promise<void> {
  if (depth > MAX_TREE_DEPTH || treeLines.length >= MAX_TREE_ENTRIES) {
    return;
  }

  const entries = await readdir(absoluteDir, { withFileTypes: true });
  entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  for (const entry of entries) {
    if (treeLines.length >= MAX_TREE_ENTRIES) {
      break;
    }

    if (entry.isDirectory() && shouldSkipDir(entry.name)) {
      continue;
    }

    const childAbsolute = path.join(absoluteDir, entry.name);
    const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!isPathInsideProject(projectRoot, childAbsolute)) {
        continue;
      }

      const dirPath = `${childRelative}/`;
      directories.push(dirPath);
      const indent = '  '.repeat(depth);
      treeLines.push(`${indent}${entry.name}/`);

      await walkDirectory(
        projectRoot,
        childAbsolute,
        childRelative,
        depth + 1,
        treeLines,
        directories,
        files,
      );
      continue;
    }

    if (entry.isFile()) {
      files.push(childRelative);
      const indent = '  '.repeat(depth);
      treeLines.push(`${indent}${entry.name}`);
    }
  }
}

export async function collectProjectDirectories(projectRoot: string): Promise<string[]> {
  let rootCanonical: string;
  try {
    rootCanonical = await realpath(projectRoot);
  } catch {
    return [];
  }

  const dirs = new Set<string>();
  let root: string;
  try {
    root = (await resolveContextPath(projectRoot, '.', {
      requireExisting: true,
      expectedType: 'directory',
    })).projectRoot;
  } catch {
    return [];
  }

  async function walk(absoluteDir: string, relativeDir: string): Promise<void> {
    if (!(await fs.pathExists(absoluteDir))) {
      return;
    }

    if (!isPathInsideProject(rootCanonical, absoluteDir)) {
      return;
    }

    const entries = await readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipDir(entry.name) || entry.isSymbolicLink()) {
        continue;
      }

      const childAbsolute = path.join(absoluteDir, entry.name);
      if (!isPathInsideProject(rootCanonical, childAbsolute)) {
        continue;
      }

      const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const normalized = `${childRelative.replace(/\\/g, '/')}/`;
      dirs.add(normalized);
      await walk(childAbsolute, childRelative);
    }
  }

  await walk(rootCanonical, '');
  return [...dirs].sort();
}
