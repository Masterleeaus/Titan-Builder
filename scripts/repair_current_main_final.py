#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path


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
    replace_once(
        'src/operations/index.ts',
        """  const resolved = await resolveProjectPath(projectRoot, relativePath, {
    requireExisting: true,
    expectedType: 'directory',
  });
""",
        """  const resolved = await resolveInternalMetadataPath(projectRoot, relativePath, {
    requireExisting: true,
    expectedType: 'directory',
  });
""",
    )
    replace_once(
        'src/operations/index.ts',
        """  const resolvedBackupPath = await resolveProjectPath(projectRoot, projectRelativePath, {
    requireExisting: true,
    expectedType: 'file',
  });
""",
        """  const resolvedBackupPath = await resolveInternalMetadataPath(projectRoot, projectRelativePath, {
    requireExisting: true,
    expectedType: 'file',
  });
""",
    )
    replace_between(
        'src/operations/index.ts',
        'async function resolveTransactionMetadataPath(',
        'async function appendTransactionHistory(',
        """async function resolveInternalMetadataPath(
  projectRoot: string,
  relativePath: string,
  options: { requireExisting?: boolean; expectedType?: 'file' | 'directory' } = {},
): Promise<string> {
  assertSafeRollbackRelativePath(relativePath, 'internal metadata');
  const candidate = path.resolve(projectRoot, relativePath);
  if (!isPathInside(projectRoot, candidate)) {
    throw new Error(`Internal metadata path escapes project root: ${relativePath}`);
  }

  const segments = path.relative(projectRoot, candidate).split(path.sep).filter(Boolean);
  let current = projectRoot;
  let exists = true;

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const metadata = await lstatPath(current);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Internal metadata path contains a symbolic link or junction: ${relativePath}`);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
      exists = false;
      break;
    }
  }

  if (!exists) {
    if (options.requireExisting) {
      throw new Error(`Internal metadata path does not exist: ${relativePath}`);
    }
    const existingAncestor = path.dirname(current);
    const canonicalAncestor = await fs.realpath(existingAncestor);
    if (!isPathInside(projectRoot, canonicalAncestor)) {
      throw new Error(`Internal metadata ancestor escapes project root: ${relativePath}`);
    }
    return candidate;
  }

  const canonicalTarget = await fs.realpath(candidate);
  if (!isPathInside(projectRoot, canonicalTarget) || canonicalTarget !== candidate) {
    throw new Error(`Internal metadata path identity changed: ${relativePath}`);
  }

  if (options.expectedType) {
    const metadata = await lstatPath(canonicalTarget);
    const matches = options.expectedType === 'directory'
      ? metadata.isDirectory()
      : metadata.isFile();
    if (!matches) {
      throw new Error(`Internal metadata path must be a ${options.expectedType}: ${relativePath}`);
    }
  }

  return canonicalTarget;
}

async function resolveTransactionMetadataPath(
  transaction: PreparedTransaction,
  relativePath: string,
): Promise<string> {
  const projectRoot = await assertRollbackProjectIdentity(transaction);
  return resolveInternalMetadataPath(projectRoot, relativePath, { expectedType: 'file' });
}

""",
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
        "import {\n"
        "  bridgeBodyLimit,\n"
        "  createPayloadTooLargeResponse,\n"
        "  isPayloadTooLargeError,\n"
        "  SMALL_BODY_LIMIT_BYTES,\n"
        "} from './body-limits.js';\n"
        "import { registerBrowserWorkflowRoutes }",
    )
    replace_once(
        'src/server/index.ts',
        """  const app = Fastify({
    logger: false,
    bodyLimit: 4_194_304,
  });
""",
        """  const app = Fastify({ logger: false, bodyLimit: SMALL_BODY_LIMIT_BYTES });
  app.setErrorHandler((error, request, reply) => {
    if (isPayloadTooLargeError(error)) {
      return reply.code(413).send(createPayloadTooLargeResponse(request));
    }
    return reply.send(error);
  });
""",
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
import { parseSkillEntrypoint } from './entrypoint.js';
import { parseSkillManifest, type TitanSkillManifest } from './manifest.js';
import { resolveContainedPackageFile } from './package-file.js';

export interface LoadedSkillEntrypoint {
  modulePath: string;
  exportName: string;
  absolutePath: string;
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
    loaded.entrypoint = {
      modulePath: parsedEntrypoint.modulePath,
      exportName: parsedEntrypoint.exportName,
      absolutePath,
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
