import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
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
  entrypoint?: { modulePath: string; exportName: string };
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

async function resolveEntrypointModule(packageRoot: string, entrypointStr: string): Promise<{ modulePath: string; exportName: string }> {
  const [modulePathStr, exportName] = entrypointStr.split('#');
  if (!modulePathStr || !exportName) {
    throw new Error(`Invalid entrypoint format: ${entrypointStr}`);
  }

  const moduleName = modulePathStr.endsWith('.js') || modulePathStr.endsWith('.ts')
    ? modulePathStr
    : `${modulePathStr}.js`;

  const canonicalRoot = await realpath(packageRoot);
  const candidate = path.resolve(packageRoot, moduleName);
  let canonicalCandidate: string;
  try {
    canonicalCandidate = await realpath(candidate);
  } catch (error) {
    throw new Error(`Unable to resolve entrypoint module ${modulePathStr}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isContained(canonicalRoot, canonicalCandidate)) {
    throw new Error(`Entrypoint module ${modulePathStr} escapes its package boundary.`);
  }

  try {
    const stats = await stat(canonicalCandidate);
    if (!stats.isFile()) {
      throw new Error(`Entrypoint module must be a regular file, not a directory or symlink.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('regular file')) {
      throw error;
    }
    throw new Error(`Unable to verify entrypoint module ${modulePathStr}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { modulePath: canonicalCandidate, exportName };
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
    loaded.entrypoint = await resolveEntrypointModule(packageRoot, manifest.entrypoint);
  }
  return loaded;
}

export async function discoverSkillPackages(libraryRoot: string): Promise<LoadedSkillPackage[]> {
  const manifests = await discoverSkillManifestPaths(libraryRoot);
  const packages: LoadedSkillPackage[] = [];
  for (const manifestPath of manifests) packages.push(await loadSkillPackage(manifestPath));
  return packages;
}
