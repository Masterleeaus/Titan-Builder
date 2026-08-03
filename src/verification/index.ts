import { readFile } from 'node:fs/promises';
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

export interface VerificationPlanResult {
  profile: VerificationProfile;
  packageManager: string;
  operations: FileOperation[];
}

export interface ProjectVerificationResult {
  profile: VerificationProfile;
  packageManager: string;
  status: 'passed' | 'failed' | 'skipped';
  operationCount: number;
  summary: string;
  error?: string;
}

export interface ProjectVerificationDependencies {
  detect?: typeof detectVerificationPlan;
  plan?: typeof planOperations;
  execute?: typeof executePlannedOperations;
  onStep?: ExecuteOptions['onStep'];
}

export async function detectVerificationPlan(
  projectRoot: string,
  profile: VerificationProfile,
): Promise<VerificationPlanResult> {
  const status = await readProjectStatus(projectRoot);
  let scripts: Record<string, string>;
  try {
    scripts = await readPackageScripts(status.repositoryRoot ?? projectRoot);
  } catch (error) {
    throw new Error(`Cannot read project scripts: ${formatUnknownError(error)}`);
  }
  return {
    profile,
    packageManager: status.packageManager,
    operations: buildVerificationPlan({
      packageManager: status.packageManager,
      scripts,
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
  const detected = await detect(projectRoot, profile);

  if (detected.operations.length === 0) {
    return {
      profile,
      packageManager: detected.packageManager,
      status: 'skipped',
      operationCount: 0,
      summary: `No approved ${profile} verification scripts were found for ${detected.packageManager}.`,
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

async function readPackageScripts(projectRoot: string): Promise<Record<string, string>> {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  let content: string;

  try {
    content = await readFile(packageJsonPath, 'utf8');
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException)?.code;
    if (errno === 'ENOENT') {
      return {};
    }
    if (errno === 'EACCES') {
      throw new Error(`package.json is not readable (permission denied)`);
    }
    throw new Error(`Failed to read package.json: ${formatUnknownError(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`package.json contains invalid JSON: ${formatUnknownError(error)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('package.json root must be an object');
  }

  const packageObj = parsed as Record<string, unknown>;
  const scripts = packageObj.scripts;

  if (scripts === undefined) {
    return {};
  }

  if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) {
    throw new Error('package.json "scripts" field must be an object');
  }

  return Object.fromEntries(
    Object.entries(scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
