#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path

SKILL_RUNTIME_REFERENCE = '04545227c23acc9bcb32cc7b84b5460f3f8ecca2'
SKILL_RUNTIME_FILES = (
    'src/skills/dispatcher.test.ts',
    'src/skills/dispatcher.ts',
    'src/skills/entrypoint.test.ts',
    'src/skills/entrypoint.ts',
    'src/skills/loader.ts',
    'src/skills/manifest.test.ts',
    'src/skills/manifest.ts',
    'src/skills/package-file.test.ts',
    'src/skills/package-file.ts',
    'src/skills/registry.test.ts',
    'src/skills/schema.test.ts',
    'src/skills/titan-skill-manifest.schema.json',
)


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding='utf-8')
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:120]!r}')
    file_path.write_text(source.replace(old, new, 1), encoding='utf-8')


def replace_between(path: str, start: str, end: str, replacement: str = '') -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding='utf-8')
    start_index = source.find(start)
    end_index = source.find(end, start_index + len(start))
    if start_index < 0 or end_index < 0:
        raise SystemExit(f'{path}: unable to locate block between {start!r} and {end!r}')
    file_path.write_text(
        source[:start_index] + replacement + source[end_index:],
        encoding='utf-8',
    )


def restore_verified_file(path: str) -> None:
    content = subprocess.check_output(
        ['git', 'show', f'{SKILL_RUNTIME_REFERENCE}:{path}'],
    )
    Path(path).write_bytes(content)


def repair_install_doctor() -> None:
    replace_once(
        'src/diagnostics/install-doctor.ts',
        """      return {
        values: Object.fromEntries(
          Object.entries(input.env).filter(([, value]) => value !== undefined && value !== null),
        ),
        fileCheck: {
""",
        """      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(input.env)) {
        if (value !== undefined) values[key] = value;
      }
      return {
        values,
        fileCheck: {
""",
    )


def repair_operations() -> None:
    replace_once(
        'src/operations/index.ts',
        "import type { FileOperation } from '../core/index.js';\n",
        "import type { FileOperation } from '../core/index.js';\n"
        "import { logger } from '../shared/index.js';\n",
    )
    replace_once(
        'src/operations/index.ts',
        "logger.error('Failed to write transaction journal during error handling', { journalError });",
        "logger.error({ err: journalError }, 'Failed to write transaction journal during error handling');",
    )
    replace_once(
        'src/operations/index.ts',
        "logger.debug('Could not stat existing file; will use default mode', { filePath, statError });",
        "logger.debug({ err: statError, filePath }, 'Could not stat existing file; will use default mode');",
    )
    replace_once(
        'src/operations/index.ts',
        "logger.warn('Failed to clean up temporary file during error recovery', { temporaryPath, removeError });",
        "logger.warn({ err: removeError, temporaryPath }, 'Failed to clean up temporary file during error recovery');",
    )


def repair_project_path() -> None:
    replace_once(
        'src/security/project-path.ts',
        '  assertNotReservedVcsPath(targetPath);',
        '  assertNoReservedVcsMetadata(targetPath);',
    )
    replace_between(
        'src/security/project-path.ts',
        'function assertNotReservedVcsPath(targetPath: string): void {',
        'function assertNotWindowsSpecialPath(targetPath: string): void {',
    )


def repair_server() -> None:
    replace_once(
        'src/server/index.ts',
        "} from './bridge-identity.js';\nimport { registerBrowserWorkflowRoutes }",
        "} from './bridge-identity.js';\n"
        "import { bridgeBodyLimit } from './body-limits.js';\n"
        "import { registerBrowserWorkflowRoutes }",
    )

    path = Path('src/server/session-store.ts')
    source = path.read_text(encoding='utf-8')
    marker = 'function constantTimeEqual(left: string, right: string): boolean {'
    if marker not in source:
        raise SystemExit('src/server/session-store.ts: constant-time helper marker missing')
    if 'export async function initializeSessionStore' in source:
        raise SystemExit('src/server/session-store.ts: persistence block already exists unexpectedly')
    persistence = """async function persistSessions(): Promise<void> {
  if (!persistenceStore) return;
  await persistenceStore.saveSessions(Array.from(sessions.values()));
}

export async function initializeSessionStore(
  store: PersistentSessionStore,
): Promise<{ recovered: number }> {
  persistenceStore = store;
  sessions.clear();
  const persisted = await store.loadSessions();
  const nowMs = Date.now();

  for (const session of persisted) {
    if (session.status === 'claimed') resetClaim(session, nowMs);
    sessions.set(session.id, session);
  }

  const retained = store.pruneByPolicy(Array.from(sessions.values()), nowMs);
  sessions.clear();
  for (const session of retained) sessions.set(session.id, session);
  await persistSessions();
  return { recovered: persisted.length };
}

export function setPersistenceStore(store: PersistentSessionStore | undefined): void {
  persistenceStore = store;
}

"""
    path.write_text(source.replace(marker, persistence + marker, 1), encoding='utf-8')


def repair_skills() -> None:
    for path in SKILL_RUNTIME_FILES:
        restore_verified_file(path)

    replace_once(
        'src/skills/handlers.ts',
        "const PROJECT_PATH_ENTRYPOINT = 'src/security/project-path.ts#resolveProjectPath';",
        "const PROJECT_PATH_ENTRYPOINT = 'runtime/entrypoint.js#resolveProjectPath';",
    )
    replace_once(
        'src/skills/entrypoint.ts',
        'Skill entrypoint module contains an invalid or traversing path segment.',
        'Skill entrypoint module contains an invalid path traversal segment.',
    )

    loader = """import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
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
  entrypoint?: LoadedSkillEntrypoint;
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
    const parsedEntrypoint = parseSkillEntrypoint(manifest.entrypoint);
    let absolutePath: string;
    try {
      absolutePath = await resolveContainedPackageFile(packageRoot, parsedEntrypoint.modulePath);
    } catch (error) {
      throw new Error(
        `Unable to resolve skill entrypoint ${manifest.entrypoint}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const approvedEntrypoint = resolveApprovedSkillEntrypoint(manifest.id, parsedEntrypoint);
    loaded.entrypoint = {
      modulePath: approvedEntrypoint.modulePath,
      exportName: approvedEntrypoint.exportName,
      absolutePath,
      handler: approvedEntrypoint.handler,
    };
  }

  return loaded;
}

export async function discoverSkillPackages(libraryRoot: string): Promise<LoadedSkillPackage[]> {
  const manifests = await discoverSkillManifestPaths(libraryRoot);
  const packages: LoadedSkillPackage[] = [];
  for (const manifestPath of manifests) packages.push(await loadSkillPackage(manifestPath));
  return packages;
}
"""
    Path('src/skills/loader.ts').write_text(loader, encoding='utf-8')


def main() -> None:
    repair_install_doctor()
    repair_operations()
    repair_project_path()
    repair_server()
    repair_skills()


if __name__ == '__main__':
    main()
