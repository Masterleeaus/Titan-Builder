import path from 'node:path';
import { lstat, readFile, realpath } from 'node:fs/promises';
import fg from 'fast-glob';
import { resolveApprovedSkillEntrypoint, type SkillRuntimeHandler } from './dispatcher.js';
import { parseSkillEntrypoint } from './entrypoint.js';
import { parseSkillManifest, type TitanSkillManifest } from './manifest.js';
import { resolveContainedPackageFile } from './package-file.js';

export interface LoadedSkillEntrypoint {
  modulePath: string;
  exportName: string;
  absolutePath: string;
  handler: SkillRuntimeHandler;
}

export interface LoadedSkillPackage {
  manifest: TitanSkillManifest;
  packageRoot: string;
  manifestPath: string;
  instructions?: string;
  entrypointPath?: string;
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveContainedFile(packageRoot: string, relativePath: string): Promise<string> {
  if (path.isAbsolute(relativePath)) throw new Error(`Skill asset must be relative: ${relativePath}`);
  const canonicalRoot = await realpath(packageRoot);
  const candidate = path.resolve(packageRoot, relativePath);
  let canonicalCandidate: string;
  try {
    canonicalCandidate = await realpath(candidate);
  } catch (error) {
    throw new Error(`Unable to read skill asset ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isContained(canonicalRoot, canonicalCandidate)) {
    throw new Error(`Skill asset ${relativePath} escapes its package boundary.`);
  }
  return canonicalCandidate;
}

async function resolveEntrypoint(packageRoot: string, entrypoint: string): Promise<string> {
  const [modulePath, exportName] = entrypoint.split('#');

  if (!modulePath || !exportName) {
    throw new Error(`Invalid entrypoint format: ${entrypoint}`);
  }

  if (!modulePath.endsWith('.js')) {
    throw new Error(`Entrypoint module must be a .js file: ${entrypoint}`);
  }

  const canonicalRoot = await realpath(packageRoot);
  const candidate = path.resolve(packageRoot, modulePath);

  if (path.isAbsolute(modulePath)) {
    throw new Error(`Entrypoint must be relative: ${entrypoint}`);
  }

  let canonicalCandidate: string;
  try {
    canonicalCandidate = await realpath(candidate);
  } catch (error) {
    throw new Error(`Unable to resolve entrypoint ${entrypoint}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isContained(canonicalRoot, canonicalCandidate)) {
    throw new Error(`Entrypoint ${entrypoint} escapes package boundary.`);
  }

  const stat = await lstat(canonicalCandidate);
  if (!stat.isFile()) {
    throw new Error(`Entrypoint must be a regular file: ${entrypoint}`);
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`Entrypoint cannot be a symlink: ${entrypoint}`);
  }

  return canonicalCandidate;
}

export async function discoverSkillManifestPaths(libraryRoot: string): Promise<string[]> {
  const canonicalRoot = await realpath(libraryRoot);
  const matches = await fg('**/manifest.json', {
    cwd: canonicalRoot,
    absolute: true,
    onlyFiles: true,
    unique: true,
    followSymbolicLinks: false,
    ignore: ['fixtures/**', '**/node_modules/**'],
  });
  return matches.map((item) => path.resolve(item)).sort((left, right) => left.localeCompare(right));
}

export async function loadSkillPackage(manifestPath: string): Promise<LoadedSkillPackage> {
  const canonicalManifest = await realpath(manifestPath);
  const packageRoot = path.dirname(canonicalManifest);
  const source = JSON.parse(await readFile(canonicalManifest, 'utf8')) as unknown;
  const manifest = parseSkillManifest(source);
  const loaded: LoadedSkillPackage = {
    manifest,
    packageRoot,
    manifestPath: canonicalManifest,
  };

  if (manifest.instructions) {
    const instructionsPath = await resolveContainedPackageFile(packageRoot, manifest.instructions);
    loaded.instructions = (await readFile(instructionsPath, 'utf8')).trim();
    if (!loaded.instructions) throw new Error(`Skill instructions are empty: ${manifest.instructions}`);
  }
  if (manifest.entrypoint) {
    const entrypointPath = await resolveEntrypoint(packageRoot, manifest.entrypoint);
    loaded.entrypointPath = entrypointPath;
  }
  return loaded;
}

export async function discoverSkillPackages(libraryRoot: string): Promise<LoadedSkillPackage[]> {
  const manifests = await discoverSkillManifestPaths(libraryRoot);
  const packages: LoadedSkillPackage[] = [];
  for (const manifestPath of manifests) packages.push(await loadSkillPackage(manifestPath));
  return packages;
}
