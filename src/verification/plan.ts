import type { FileOperation } from '../core/types/index.js';

export type VerificationProfile = 'quick' | 'standard' | 'full';

interface BuildVerificationPlanInput {
  packageManager: string;
  scripts: Record<string, string>;
  profile: VerificationProfile;
}

export function buildVerificationPlan(
  input: BuildVerificationPlanInput,
): FileOperation[] {
  const tool = toolForPackageManager(input.packageManager);
  if (!tool) {
    return [];
  }

  const scriptNames = selectScripts(input.scripts, input.profile);
  return scriptNames.map((script) => ({
    action: 'RUN_TOOL' as const,
    tool,
    args: [script],
  }));
}

function toolForPackageManager(packageManager: string): 'npm.run' | 'pnpm.run' | null {
  if (packageManager === 'npm') {
    return 'npm.run';
  }
  if (packageManager === 'pnpm') {
    return 'pnpm.run';
  }
  return null;
}

function selectScripts(
  scripts: Record<string, string>,
  profile: VerificationProfile,
): string[] {
  if (profile === 'full' && scripts.verify) {
    return ['verify'];
  }

  if (profile === 'quick') {
    const focused = firstExisting(scripts, [
      'test:node',
      'test:unit',
      'test:quick',
      'check',
      'typecheck',
      'test',
    ]);
    return focused ? [focused] : [];
  }

  if (profile === 'full') {
    return uniqueExisting(scripts, [
      'check',
      'lint',
      'typecheck',
      'test',
      'build',
    ]);
  }

  return uniqueExisting(scripts, ['typecheck', 'test', 'build']);
}

function firstExisting(
  scripts: Record<string, string>,
  candidates: string[],
): string | null {
  return candidates.find((name) => Boolean(scripts[name])) ?? null;
}

function uniqueExisting(
  scripts: Record<string, string>,
  candidates: string[],
): string[] {
  return [...new Set(candidates.filter((name) => Boolean(scripts[name])))];
}
