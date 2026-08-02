import type { TitanSkillManifest } from './manifest.js';
import type { LoadedSkillPackage } from './loader.js';

export interface ActivationRequirements {
  runtimeTarget: string;
  titanVersion?: string;
  platform?: 'linux' | 'windows' | 'macos' | 'browser';
  provider?: string;
}

export type ActivationStatus = 'available' | 'deprecated' | 'incompatible' | 'missing_dependency' | 'unavailable';

export interface ActivationIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  field?: string;
}

export interface ActivationResult {
  status: ActivationStatus;
  available: boolean;
  manifest: TitanSkillManifest;
  issues: ActivationIssue[];
  requiresApproval: boolean;
  capabilities: string[];
  risk: string;
  deprecationMessage?: string;
}

function compareVersions(current: string, required: string): boolean {
  const parse = (v: string) => v.split('.').map((x) => parseInt(x, 10));
  const curr = parse(current);
  const req = parse(required);
  for (let i = 0; i < Math.max(curr.length, req.length); i++) {
    const c = curr[i] || 0;
    const r = req[i] || 0;
    if (c > r) return true;
    if (c < r) return false;
  }
  return true;
}

export function validateSkillActivation(
  skill: LoadedSkillPackage,
  requirements: ActivationRequirements,
  allSkills: readonly LoadedSkillPackage[],
  titanVersion: string = '0.5.0',
): ActivationResult {
  const issues: ActivationIssue[] = [];
  let status: ActivationStatus = 'available';

  const manifest = skill.manifest;

  if (manifest.status === 'deprecated') {
    status = 'deprecated';
    if (manifest.deprecation?.message) {
      issues.push({
        code: 'skill_deprecated',
        message: manifest.deprecation.message,
        severity: 'warning',
      });
    }
  }

  if (!manifest.runtimeTargets.includes(requirements.runtimeTarget as any)) {
    status = 'incompatible';
    issues.push({
      code: 'runtime_target_mismatch',
      message: `Skill is not compatible with runtime target '${requirements.runtimeTarget}'. Supported targets: ${manifest.runtimeTargets.join(', ')}`,
      severity: 'error',
      field: 'runtimeTargets',
    });
  }

  if (manifest.compatibility?.minTitanVersion) {
    if (!compareVersions(titanVersion, manifest.compatibility.minTitanVersion)) {
      status = 'incompatible';
      issues.push({
        code: 'titan_version_mismatch',
        message: `Skill requires Titan version ${manifest.compatibility.minTitanVersion} or later, but current version is ${titanVersion}`,
        severity: 'error',
        field: 'minTitanVersion',
      });
    }
  }

  if (requirements.platform && manifest.compatibility?.platforms) {
    if (!manifest.compatibility.platforms.includes(requirements.platform)) {
      status = 'incompatible';
      issues.push({
        code: 'platform_mismatch',
        message: `Skill is not compatible with platform '${requirements.platform}'. Supported platforms: ${manifest.compatibility.platforms.join(', ')}`,
        severity: 'error',
        field: 'platforms',
      });
    }
  }

  if (requirements.provider && manifest.compatibility?.providers) {
    if (!manifest.compatibility.providers.includes(requirements.provider)) {
      status = 'incompatible';
      issues.push({
        code: 'provider_mismatch',
        message: `Skill is not compatible with provider '${requirements.provider}'. Supported providers: ${manifest.compatibility.providers.join(', ')}`,
        severity: 'error',
        field: 'providers',
      });
    }
  }

  const skillMap = new Map(allSkills.map((s) => [s.manifest.id, s]));
  const visited = new Set<string>();

  function validateDependency(depId: string, chain: string[] = []): boolean {
    if (visited.has(depId)) {
      if (chain.includes(depId)) {
        status = 'missing_dependency';
        issues.push({
          code: 'circular_dependency',
          message: `Circular dependency detected: ${[...chain, depId].join(' -> ')}`,
          severity: 'error',
          field: 'dependencies',
        });
        return false;
      }
      return true;
    }
    visited.add(depId);

    const dep = skillMap.get(depId);
    if (!dep) {
      status = 'missing_dependency';
      issues.push({
        code: 'missing_dependency',
        message: `Required skill dependency '${depId}' is not available`,
        severity: 'error',
        field: 'dependencies',
      });
      return false;
    }

    for (const transitiveDep of dep.manifest.dependencies) {
      if (!validateDependency(transitiveDep, [...chain, depId])) {
        return false;
      }
    }

    return true;
  }

  for (const dep of manifest.dependencies) {
    validateDependency(dep);
  }

  const requiresApproval = manifest.approval !== 'none';

  const result: ActivationResult = {
    status: status === 'available' && issues.some((i) => i.severity === 'error') ? 'unavailable' : status,
    available: !issues.some((i) => i.severity === 'error') && status !== 'incompatible' && status !== 'missing_dependency',
    manifest,
    issues,
    requiresApproval,
    capabilities: manifest.capabilities,
    risk: manifest.risk,
    deprecationMessage: manifest.deprecation?.message,
  };

  return result;
}

export function createActivationResolver(
  skills: readonly LoadedSkillPackage[],
  titanVersion?: string,
) {
  const skillMap = new Map(skills.map((s) => [s.manifest.id, s]));

  return {
    validate(idOrAlias: string, requirements: ActivationRequirements) {
      const skill = Array.from(skillMap.values()).find(
        (s) => s.manifest.id === idOrAlias || (s.manifest.aliases?.includes(idOrAlias) ?? false),
      );

      if (!skill) {
        return {
          status: 'unavailable' as const,
          available: false,
          manifest: null as any,
          issues: [{ code: 'not_found', message: `Skill '${idOrAlias}' not found`, severity: 'error' as const }],
          requiresApproval: false,
          capabilities: [],
          risk: 'READ' as const,
        };
      }

      return validateSkillActivation(skill, requirements, skills, titanVersion);
    },

    validateAll(requirements: ActivationRequirements) {
      return Array.from(skillMap.values()).map((skill) =>
        validateSkillActivation(skill, requirements, skills, titanVersion),
      );
    },

    listAvailable(requirements: ActivationRequirements) {
      return this.validateAll(requirements).filter((result) => result.available);
    },

    listGuidanceSkills(requirements: ActivationRequirements) {
      return this.validateAll(requirements).filter(
        (result) => result.available && result.manifest.kind === 'guidance' && result.manifest.instructions,
      );
    },
  };
}
