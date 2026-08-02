import { constants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import type { FileOperation } from '../core/types/index.js';
import {
  executePlannedOperations,
  planOperations,
  type ExecuteOptions,
  type PlannedOperation,
} from '../operations/index.js';
import { readProjectStatus } from '../project/status.js';
import { buildVerificationPlan, type VerificationProfile } from './plan.js';

export type ProjectVerificationErrorCode =
  | 'PACKAGE_MANIFEST_INVALID_JSON'
  | 'PACKAGE_MANIFEST_INVALID_SHAPE'
  | 'PACKAGE_MANIFEST_NOT_FILE'
  | 'PACKAGE_MANIFEST_SYMLINK'
  | 'PACKAGE_MANIFEST_UNREADABLE'
  | 'PACKAGE_MANIFEST_CHANGED'
  | 'PACKAGE_SCRIPTS_INVALID'
  | 'VERIFICATION_DETECTION_FAILED';

export interface VerificationPlanResult {
  profile: VerificationProfile;
  packageManager: string;
  manifestStatus: 'missing' | 'present';
  operations: FileOperation[];
}

export interface ProjectVerificationResult {
  profile: VerificationProfile;
  packageManager: string;
  status: 'passed' | 'failed' | 'skipped';
  operationCount: number;
  summary: string;
  error?: string;
  errorCode?: ProjectVerificationErrorCode;
}

export interface ProjectVerificationDependencies {
  detect?: typeof detectVerificationPlan;
  plan?: typeof planOperations;
  execute?: typeof executePlannedOperations;
  onStep?: ExecuteOptions['onStep'];
}

export interface PackageManifestSnapshot {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

interface PackageScriptsResult {
  status: 'missing' | 'present';
  scripts: Record<string, string>;
}

class ProjectMetadataError extends Error {
  readonly code: ProjectVerificationErrorCode;
  packageManager?: string;

  constructor(
    code: ProjectVerificationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProjectMetadataError';
    this.code = code;
  }
}

export async function detectVerificationPlan(
  projectRoot: string,
  profile: VerificationProfile,
): Promise<VerificationPlanResult> {
  const status = await readProjectStatus(projectRoot);

  let manifest: PackageScriptsResult;
  try {
    manifest = await readPackageScripts(status.repositoryRoot ?? projectRoot);
  } catch (error) {
    if (error instanceof ProjectMetadataError) {
      error.packageManager = status.packageManager;
    }
    throw error;
  }

  return {
    profile,
    packageManager: status.packageManager,
    manifestStatus: manifest.status,
    operations: buildVerificationPlan({
      packageManager: status.packageManager,
      scripts: manifest.scripts,
      profile,
    }),
  };
}

export async function runProjectVerification(
  projectRoot: string,
  profile: VerificationProfile,
  dependencies: ProjectVerificationDependencies = {},
): Promise<ProjectVerificationResult> {
  const detect = dependencies.detect ?? detectVerificationPlan;
  const plan = dependencies.plan ?? planOperations;
  const execute = dependencies.execute ?? executePlannedOperations;

  let detected: VerificationPlanResult;
  try {
    detected = await detect(projectRoot, profile);
  } catch (error) {
    const metadataError = error instanceof ProjectMetadataError ? error : undefined;
    return {
      profile,
      packageManager: metadataError?.packageManager ?? 'unknown',
      status: 'failed',
      operationCount: 0,
      summary: `${profile} verification could not inspect project metadata`,
      error: formatUnknownError(error),
      errorCode: metadataError?.code ?? 'VERIFICATION_DETECTION_FAILED',
    };
  }

  if (detected.operations.length === 0) {
    return {
      profile,
      packageManager: detected.packageManager,
      status: 'skipped',
      operationCount: 0,
      summary: detected.manifestStatus === 'missing'
        ? `No package.json was found; ${profile} verification was skipped for ${detected.packageManager}.`
        : `No approved ${profile} verification scripts were found for ${detected.packageManager}.`,
    };
  }

  let plans: PlannedOperation[];
  try {
    plans = await plan(detected.operations, projectRoot);
  } catch (error) {
    const message = formatUnknownError(error);
    return {
      profile,
      packageManager: detected.packageManager,
      status: 'failed',
      operationCount: detected.operations.length,
      summary: `${profile} verification could not be planned`,
      error: message,
    };
  }

  try {
    await execute(plans, projectRoot, { onStep: dependencies.onStep });
    return {
      profile,
      packageManager: detected.packageManager,
      status: 'passed',
      operationCount: plans.length,
      summary: `${profile} verification completed`,
    };
  } catch (error) {
    const message = formatUnknownError(error);
    return {
      profile,
      packageManager: detected.packageManager,
      status: 'failed',
      operationCount: plans.length,
      summary: `${profile} verification failed`,
      error: message,
    };
  }
}

export function parseVerificationProfile(value: string): VerificationProfile {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'quick' || normalized === 'standard' || normalized === 'full') {
    return normalized;
  }
  throw new Error('Verification profile must be quick, standard, or full');
}

export function packageManifestSnapshotChanged(
  before: PackageManifestSnapshot,
  after: PackageManifestSnapshot,
): boolean {
  return before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ctimeMs !== after.ctimeMs;
}

async function readPackageScripts(projectRoot: string): Promise<PackageScriptsResult> {
  const manifestPath = path.join(projectRoot, 'package.json');
  let initialStat: Stats;

  try {
    initialStat = await lstat(manifestPath);
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) {
      return { status: 'missing', scripts: {} };
    }
    throw unreadableManifestError(manifestPath, 'inspect', error);
  }

  if (initialStat.isSymbolicLink()) {
    throw new ProjectMetadataError(
      'PACKAGE_MANIFEST_SYMLINK',
      `package.json must be a regular file, not a symbolic link: ${manifestPath}`,
    );
  }
  if (!initialStat.isFile()) {
    throw new ProjectMetadataError(
      'PACKAGE_MANIFEST_NOT_FILE',
      `package.json must be a regular file: ${manifestPath}`,
    );
  }

  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(manifestPath, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (isErrnoException(error, 'ELOOP')) {
      throw new ProjectMetadataError(
        'PACKAGE_MANIFEST_SYMLINK',
        `package.json resolved through a symbolic link: ${manifestPath}`,
        { cause: error },
      );
    }
    throw unreadableManifestError(manifestPath, 'open', error);
  }

  try {
    const initialSnapshot = snapshotFromStat(initialStat);
    const openedSnapshot = snapshotFromStat(await handle.stat());
    if (packageManifestSnapshotChanged(initialSnapshot, openedSnapshot)) {
      throw changedManifestError(manifestPath);
    }

    let content: string;
    try {
      content = await handle.readFile({ encoding: 'utf8' });
    } catch (error) {
      throw unreadableManifestError(manifestPath, 'read', error);
    }

    const readSnapshot = snapshotFromStat(await handle.stat());
    let currentStat: Stats;
    try {
      currentStat = await lstat(manifestPath);
    } catch (error) {
      if (isErrnoException(error, 'ENOENT')) {
        throw changedManifestError(manifestPath, error);
      }
      throw unreadableManifestError(manifestPath, 'revalidate', error);
    }

    if (currentStat.isSymbolicLink() || !currentStat.isFile()) {
      throw changedManifestError(manifestPath);
    }

    const currentSnapshot = snapshotFromStat(currentStat);
    if (
      packageManifestSnapshotChanged(openedSnapshot, readSnapshot)
      || packageManifestSnapshotChanged(readSnapshot, currentSnapshot)
    ) {
      throw changedManifestError(manifestPath);
    }

    return {
      status: 'present',
      scripts: parsePackageScripts(content, manifestPath),
    };
  } finally {
    await handle.close();
  }
}

function parsePackageScripts(content: string, manifestPath: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new ProjectMetadataError(
      'PACKAGE_MANIFEST_INVALID_JSON',
      `package.json must contain valid JSON: ${manifestPath}: ${formatUnknownError(error)}`,
      { cause: error },
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProjectMetadataError(
      'PACKAGE_MANIFEST_INVALID_SHAPE',
      `package.json must contain a JSON object: ${manifestPath}`,
    );
  }

  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (scripts === undefined) {
    return {};
  }
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    throw new ProjectMetadataError(
      'PACKAGE_SCRIPTS_INVALID',
      `package.json scripts must be an object of string commands: ${manifestPath}`,
    );
  }

  const entries = Object.entries(scripts);
  const invalidEntry = entries.find(([, command]) => typeof command !== 'string');
  if (invalidEntry) {
    throw new ProjectMetadataError(
      'PACKAGE_SCRIPTS_INVALID',
      `package.json script "${invalidEntry[0]}" must be a string command: ${manifestPath}`,
    );
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function snapshotFromStat(stat: Stats): PackageManifestSnapshot {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function changedManifestError(manifestPath: string, cause?: unknown): ProjectMetadataError {
  return new ProjectMetadataError(
    'PACKAGE_MANIFEST_CHANGED',
    `package.json changed or was replaced while verification metadata was being read: ${manifestPath}`,
    cause === undefined ? undefined : { cause },
  );
}

function unreadableManifestError(
  manifestPath: string,
  action: string,
  cause: unknown,
): ProjectMetadataError {
  return new ProjectMetadataError(
    'PACKAGE_MANIFEST_UNREADABLE',
    `Unable to ${action} package.json at ${manifestPath}: ${formatUnknownError(cause)}`,
    { cause },
  );
}

function isErrnoException(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
