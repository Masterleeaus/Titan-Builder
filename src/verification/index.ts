import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileOperation } from '../core/types/index.js';
import { readProjectStatus } from '../project/status.js';
import { buildVerificationPlan, type VerificationProfile } from './plan.js';

export interface VerificationPlanResult {
  profile: VerificationProfile;
  packageManager: string;
  operations: FileOperation[];
}

export async function detectVerificationPlan(
  projectRoot: string,
  profile: VerificationProfile,
): Promise<VerificationPlanResult> {
  const status = await readProjectStatus(projectRoot);
  const scripts = await readPackageScripts(status.repositoryRoot ?? projectRoot);
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

export function parseVerificationProfile(value: string): VerificationProfile {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'quick' || normalized === 'standard' || normalized === 'full') {
    return normalized;
  }
  throw new Error('Verification profile must be quick, standard, or full');
}

async function readPackageScripts(projectRoot: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(path.join(projectRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(content) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed.scripts).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}
