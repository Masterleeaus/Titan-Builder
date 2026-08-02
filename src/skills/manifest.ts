import { z } from 'zod';
import { parseSkillEntrypoint } from './entrypoint.js';

export const SKILL_MANIFEST_SCHEMA_VERSION = '1' as const;
export const SKILL_KINDS = ['guidance', 'executable', 'orchestration', 'adapter'] as const;
export const SKILL_STATUSES = ['experimental', 'stable', 'deprecated'] as const;
export const SKILL_RUNTIME_TARGETS = [
  'root',
  'cli',
  'extension-background',
  'extension-content',
  'extension-sidepanel',
  'workspace-companion',
  'git-hook',
  'github-actions',
] as const;
export const SKILL_RISKS = [
  'READ',
  'SAFE_EXECUTION',
  'WRITE',
  'NETWORK_WRITE',
  'ARBITRARY_EXECUTION',
  'DESTRUCTIVE',
  'PUBLISH',
] as const;
export const SKILL_APPROVAL_MODES = ['none', 'explicit', 'policy'] as const;
export const SKILL_CAPABILITIES = [
  'filesystem.read',
  'filesystem.write',
  'process.execute',
  'network.read',
  'network.write',
  'browser.read',
  'browser.write',
  'git.read',
  'git.write',
  'storage.read',
  'storage.write',
  'secrets.read',
  'publish',
] as const;
export const SKILL_PLATFORMS = ['linux', 'windows', 'macos', 'browser'] as const;

const canonicalId = /^titan\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const compatibleId = /^(?:titan\.)?[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const semver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const entrypoint = /^(?![A-Za-z]:[\\/])(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9_/.-]+#[A-Za-z_$][A-Za-z0-9_$]*$/u;
const relativeAsset = /^(?![A-Za-z]:[\\/])(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+$/u;
const highSideEffectRisks = new Set(['NETWORK_WRITE', 'ARBITRARY_EXECUTION', 'DESTRUCTIVE', 'PUBLISH']);

const entrypointSchema = z.string().superRefine((value, context) => {
  try {
    parseSkillEntrypoint(value);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'Invalid skill entrypoint.',
    });
  }
});

const jsonObjectSchema = z.record(z.unknown()).superRefine((value, context) => {
  if (value.type !== 'object') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'JSON schema must declare type "object".' });
  }
});

const manifestSchema = z.object({
  schemaVersion: z.literal(SKILL_MANIFEST_SCHEMA_VERSION),
  id: z.string().regex(canonicalId, 'Skill ID must be a canonical titan.* identifier.'),
  name: z.string().trim().min(1).max(120),
  version: z.string().regex(semver, 'Version must use semantic versioning.'),
  status: z.enum(SKILL_STATUSES),
  kind: z.enum(SKILL_KINDS),
  category: z.string().regex(slug, 'Category must be a lowercase kebab-case slug.'),
  description: z.string().trim().min(1).max(500),
  owner: z.string().trim().min(1).max(120),
  runtimeTargets: z.array(z.enum(SKILL_RUNTIME_TARGETS)).min(1),
  entrypoint: entrypointSchema.optional(),
  instructions: z.string().regex(relativeAsset, 'Instructions must be a contained relative asset path.').optional(),
  inputs: jsonObjectSchema,
  outputs: jsonObjectSchema,
  dependencies: z.array(z.string().regex(canonicalId)).default([]),
  capabilities: z.array(z.enum(SKILL_CAPABILITIES)).default([]),
  risk: z.enum(SKILL_RISKS),
  approval: z.enum(SKILL_APPROVAL_MODES),
  tags: z.array(z.string().regex(slug)).default([]),
  aliases: z.array(z.string().regex(compatibleId)).optional(),
  compatibility: z.object({
    minTitanVersion: z.string().regex(semver).optional(),
    platforms: z.array(z.enum(SKILL_PLATFORMS)).optional(),
    providers: z.array(z.string().trim().min(1)).optional(),
  }).strict().optional(),
  deprecation: z.object({
    message: z.string().trim().min(1),
    replacedBy: z.string().regex(canonicalId).optional(),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.kind === 'guidance' && !value.instructions) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['instructions'], message: 'Guidance skills require an instructions asset.' });
  }
  if ((value.kind === 'executable' || value.kind === 'adapter') && !value.entrypoint) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['entrypoint'], message: `${value.kind} skills require an entrypoint.` });
  }
  if (highSideEffectRisks.has(value.risk) && value.approval === 'none') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['approval'], message: `${value.risk} skills require explicit or policy approval.` });
  }
  if (value.status === 'deprecated' && !value.deprecation) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['deprecation'], message: 'Deprecated skills require deprecation metadata.' });
  }
  const aliases = value.aliases ?? [];
  if (aliases.includes(value.id)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['aliases'], message: 'A skill cannot alias its canonical ID.' });
  }
  if (new Set(aliases).size !== aliases.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['aliases'], message: 'Skill aliases must be unique.' });
  }
  if (value.dependencies.includes(value.id)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dependencies'], message: 'A skill cannot depend on itself.' });
  }
  if (new Set(value.dependencies).size !== value.dependencies.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dependencies'], message: 'Skill dependencies must be unique.' });
  }
  if (new Set(value.runtimeTargets).size !== value.runtimeTargets.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['runtimeTargets'], message: 'Runtime targets must be unique.' });
  }
});

export type TitanSkillManifest = z.infer<typeof manifestSchema>;

export interface SkillManifestIssue {
  path: string;
  message: string;
}

export type SkillManifestValidationResult =
  | { success: true; data: TitanSkillManifest; issues: [] }
  | { success: false; issues: SkillManifestIssue[] };

export function validateSkillManifest(input: unknown): SkillManifestValidationResult {
  const result = manifestSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data, issues: [] };
  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.join('.') : '$',
      message: issue.message,
    })),
  };
}

export function parseSkillManifest(input: unknown): TitanSkillManifest {
  const result = validateSkillManifest(input);
  if (result.success) return result.data;
  const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
  throw new Error(`Invalid Titan skill manifest: ${detail}`);
}
