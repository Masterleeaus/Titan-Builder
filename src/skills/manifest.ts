import manifestSchema from './titan-skill-manifest.schema.json' with { type: 'json' };

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

export type SkillKind = typeof SKILL_KINDS[number];
export type SkillStatus = typeof SKILL_STATUSES[number];
export type SkillRuntimeTarget = typeof SKILL_RUNTIME_TARGETS[number];
export type SkillRisk = typeof SKILL_RISKS[number];
export type SkillApprovalMode = typeof SKILL_APPROVAL_MODES[number];
export type SkillCapability = typeof SKILL_CAPABILITIES[number];
export type SkillPlatform = typeof SKILL_PLATFORMS[number];
export type JsonSchemaObject = Record<string, unknown> & { type: 'object' };

export interface SkillCompatibility {
  minTitanVersion?: string;
  platforms?: SkillPlatform[];
  providers?: string[];
}

export interface SkillDeprecation {
  message: string;
  replacedBy?: string;
}

export interface TitanSkillManifest {
  schemaVersion: typeof SKILL_MANIFEST_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  status: SkillStatus;
  kind: SkillKind;
  category: string;
  description: string;
  owner: string;
  runtimeTargets: SkillRuntimeTarget[];
  entrypoint?: string;
  instructions?: string;
  inputs: JsonSchemaObject;
  outputs: JsonSchemaObject;
  dependencies: string[];
  capabilities: SkillCapability[];
  risk: SkillRisk;
  approval: SkillApprovalMode;
  tags: string[];
  aliases?: string[];
  compatibility?: SkillCompatibility;
  deprecation?: SkillDeprecation;
}

export interface SkillManifestIssue {
  path: string;
  message: string;
}

export type SkillManifestValidationResult =
  | { success: true; data: TitanSkillManifest; issues: [] }
  | { success: false; issues: SkillManifestIssue[] };

export const TITAN_SKILL_MANIFEST_JSON_SCHEMA = manifestSchema;

const SKILL_ID = /^titan\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const LEGACY_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const ENTRYPOINT = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+#[A-Za-z_$][A-Za-z0-9_$]*$/u;
const HIGH_SIDE_EFFECT_RISKS = new Set<SkillRisk>([
  'NETWORK_WRITE',
  'ARBITRARY_EXECUTION',
  'DESTRUCTIVE',
  'PUBLISH',
]);
const MANIFEST_KEYS = new Set([
  'schemaVersion',
  'id',
  'name',
  'version',
  'status',
  'kind',
  'category',
  'description',
  'owner',
  'runtimeTargets',
  'entrypoint',
  'instructions',
  'inputs',
  'outputs',
  'dependencies',
  'capabilities',
  'risk',
  'approval',
  'tags',
  'aliases',
  'compatibility',
  'deprecation',
]);

export class SkillManifestValidationError extends Error {
  readonly issues: SkillManifestIssue[];

  constructor(issues: SkillManifestIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'SkillManifestValidationError';
    this.issues = issues;
  }
}

export function validateSkillManifest(value: unknown): SkillManifestValidationResult {
  const issues: SkillManifestIssue[] = [];
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: '$', message: 'manifest must be an object' }] };
  }

  rejectUnknownKeys(value, MANIFEST_KEYS, issues);

  const schemaVersion = requiredString(value, 'schemaVersion', issues);
  const id = requiredString(value, 'id', issues);
  const name = requiredString(value, 'name', issues);
  const version = requiredString(value, 'version', issues);
  const status = enumValue(value, 'status', SKILL_STATUSES, issues);
  const kind = enumValue(value, 'kind', SKILL_KINDS, issues);
  const category = requiredString(value, 'category', issues);
  const description = requiredString(value, 'description', issues);
  const owner = requiredString(value, 'owner', issues);
  const runtimeTargets = stringArray(
    value,
    'runtimeTargets',
    SKILL_RUNTIME_TARGETS,
    issues,
    { min: 1 },
  ) as SkillRuntimeTarget[] | undefined;
  const entrypoint = optionalString(value, 'entrypoint', issues);
  const instructions = optionalString(value, 'instructions', issues);
  const inputs = schemaObject(value, 'inputs', issues);
  const outputs = schemaObject(value, 'outputs', issues);
  const dependencies = stringArray(value, 'dependencies', null, issues);
  const capabilities = stringArray(
    value,
    'capabilities',
    SKILL_CAPABILITIES,
    issues,
  ) as SkillCapability[] | undefined;
  const risk = enumValue(value, 'risk', SKILL_RISKS, issues);
  const approval = enumValue(value, 'approval', SKILL_APPROVAL_MODES, issues);
  const tags = stringArray(value, 'tags', null, issues, { min: 1 });
  const aliases = optionalStringArray(value, 'aliases', null, issues);
  const compatibility = compatibilityValue(value.compatibility, issues);
  const deprecation = deprecationValue(value.deprecation, issues);

  if (schemaVersion && schemaVersion !== SKILL_MANIFEST_SCHEMA_VERSION) {
    issue(issues, 'schemaVersion', `must equal ${SKILL_MANIFEST_SCHEMA_VERSION}`);
  }
  if (id && !SKILL_ID.test(id)) issue(issues, 'id', 'must use the titan.<category>.<name> format');
  if (name && (name.length < 3 || name.length > 120)) issue(issues, 'name', 'must contain 3 to 120 characters');
  if (version && !SEMVER.test(version)) issue(issues, 'version', 'must be a semantic version');
  if (category && !SLUG.test(category)) issue(issues, 'category', 'must be a lowercase kebab-case slug');
  if (description && (description.length < 10 || description.length > 1000)) {
    issue(issues, 'description', 'must contain 10 to 1000 characters');
  }
  if (owner && (owner.length < 2 || owner.length > 120)) issue(issues, 'owner', 'must contain 2 to 120 characters');

  for (const dependency of dependencies ?? []) {
    if (!SKILL_ID.test(dependency)) issue(issues, 'dependencies', `invalid skill ID: ${dependency}`);
    if (dependency === id) issue(issues, 'dependencies', 'must not contain the manifest ID');
  }
  for (const alias of aliases ?? []) {
    if (!LEGACY_ID.test(alias)) issue(issues, 'aliases', `invalid alias: ${alias}`);
    if (alias === id) issue(issues, 'aliases', 'must not contain the manifest ID');
  }

  if (kind === 'guidance') {
    if (!instructions || instructions.length < 20) {
      issue(issues, 'instructions', 'guidance skills require at least 20 characters of instructions');
    }
    if (entrypoint !== undefined) issue(issues, 'entrypoint', 'guidance skills must not declare an entrypoint');
    if (risk && risk !== 'READ') issue(issues, 'risk', 'guidance skills must use READ risk');
    if (approval && approval !== 'none') issue(issues, 'approval', 'guidance skills must use no approval');
    if (capabilities && capabilities.length > 0) issue(issues, 'capabilities', 'guidance skills must not request capabilities');
  } else if (kind && (!entrypoint || !ENTRYPOINT.test(entrypoint))) {
    issue(issues, 'entrypoint', 'executable, orchestration, and adapter skills require path#export');
  }

  if (risk && HIGH_SIDE_EFFECT_RISKS.has(risk) && approval === 'none') {
    issue(issues, 'approval', `${risk} skills require explicit or policy approval`);
  }
  if (status === 'deprecated' && !deprecation) {
    issue(issues, 'deprecation', 'deprecated skills require migration guidance');
  }
  if (status && status !== 'deprecated' && deprecation) {
    issue(issues, 'deprecation', 'only deprecated skills may declare deprecation metadata');
  }
  if (deprecation?.replacedBy) {
    if (!SKILL_ID.test(deprecation.replacedBy)) issue(issues, 'deprecation.replacedBy', 'must be a Titan skill ID');
    if (deprecation.replacedBy === id) issue(issues, 'deprecation.replacedBy', 'must not equal the manifest ID');
  }

  if (issues.length > 0 || !schemaVersion || !id || !name || !version || !status || !kind
    || !category || !description || !owner || !runtimeTargets || !inputs || !outputs
    || !dependencies || !capabilities || !risk || !approval || !tags) {
    return { success: false, issues };
  }

  return {
    success: true,
    issues: [],
    data: {
      schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
      id,
      name,
      version,
      status,
      kind,
      category,
      description,
      owner,
      runtimeTargets,
      ...(entrypoint === undefined ? {} : { entrypoint }),
      ...(instructions === undefined ? {} : { instructions }),
      inputs,
      outputs,
      dependencies,
      capabilities,
      risk,
      approval,
      tags,
      ...(aliases === undefined ? {} : { aliases }),
      ...(compatibility === undefined ? {} : { compatibility }),
      ...(deprecation === undefined ? {} : { deprecation }),
    },
  };
}

export function parseSkillManifest(value: unknown): TitanSkillManifest {
  const result = validateSkillManifest(value);
  if (!result.success) throw new SkillManifestValidationError(result.issues);
  return result.data;
}

function issue(issues: SkillManifestIssue[], path: string, message: string): void {
  if (!issues.some((item) => item.path === path && item.message === message)) issues.push({ path, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  issues: SkillManifestIssue[],
  prefix = '',
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issue(issues, prefix ? `${prefix}.${key}` : key, 'is not a declared field');
  }
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  issues: SkillManifestIssue[],
): string | undefined {
  const candidate = value[key];
  if (typeof candidate !== 'string' || !candidate.trim()) {
    issue(issues, key, 'is required and must be a non-empty string');
    return undefined;
  }
  return candidate.trim();
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
  issues: SkillManifestIssue[],
): string | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== 'string' || !candidate.trim()) {
    issue(issues, key, 'must be a non-empty string when present');
    return undefined;
  }
  return candidate.trim();
}

function enumValue<const T extends readonly string[]>(
  value: Record<string, unknown>,
  key: string,
  allowed: T,
  issues: SkillManifestIssue[],
): T[number] | undefined {
  const candidate = requiredString(value, key, issues);
  if (!candidate) return undefined;
  if (!allowed.includes(candidate)) {
    issue(issues, key, `must be one of: ${allowed.join(', ')}`);
    return undefined;
  }
  return candidate as T[number];
}

function stringArray<const T extends readonly string[] | null>(
  value: Record<string, unknown>,
  key: string,
  allowed: T,
  issues: SkillManifestIssue[],
  options: { min?: number } = {},
): string[] | (T extends readonly string[] ? T[number][] : never) | undefined {
  const candidate = value[key];
  if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== 'string' || !item.trim())) {
    issue(issues, key, 'must be an array of non-empty strings');
    return undefined;
  }
  const normalized = candidate.map((item) => String(item).trim());
  if ((options.min ?? 0) > normalized.length) issue(issues, key, `must contain at least ${options.min} item(s)`);
  if (new Set(normalized).size !== normalized.length) issue(issues, key, 'must not contain duplicates');
  if (allowed) {
    for (const item of normalized) {
      if (!allowed.includes(item)) issue(issues, key, `unsupported value: ${item}`);
    }
  }
  return normalized as string[] | (T extends readonly string[] ? T[number][] : never);
}

function optionalStringArray<const T extends readonly string[] | null>(
  value: Record<string, unknown>,
  key: string,
  allowed: T,
  issues: SkillManifestIssue[],
): string[] | (T extends readonly string[] ? T[number][] : never) | undefined {
  if (value[key] === undefined) return undefined;
  return stringArray(value, key, allowed, issues);
}

function schemaObject(
  value: Record<string, unknown>,
  key: string,
  issues: SkillManifestIssue[],
): JsonSchemaObject | undefined {
  const candidate = value[key];
  if (!isRecord(candidate)) {
    issue(issues, key, 'must be a JSON Schema object');
    return undefined;
  }
  if (candidate.type !== 'object') {
    issue(issues, `${key}.type`, 'must equal object');
    return undefined;
  }
  return candidate as JsonSchemaObject;
}

function compatibilityValue(value: unknown, issues: SkillManifestIssue[]): SkillCompatibility | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issue(issues, 'compatibility', 'must be an object');
    return undefined;
  }
  rejectUnknownKeys(value, new Set(['minTitanVersion', 'platforms', 'providers']), issues, 'compatibility');
  const minTitanVersion = optionalString(value, 'minTitanVersion', issues);
  if (minTitanVersion && !SEMVER.test(minTitanVersion)) {
    issue(issues, 'compatibility.minTitanVersion', 'must be a semantic version');
  }
  const platforms = optionalStringArray(value, 'platforms', SKILL_PLATFORMS, issues) as SkillPlatform[] | undefined;
  const providers = optionalStringArray(value, 'providers', null, issues) as string[] | undefined;
  return {
    ...(minTitanVersion === undefined ? {} : { minTitanVersion }),
    ...(platforms === undefined ? {} : { platforms }),
    ...(providers === undefined ? {} : { providers }),
  };
}

function deprecationValue(value: unknown, issues: SkillManifestIssue[]): SkillDeprecation | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issue(issues, 'deprecation', 'must be an object');
    return undefined;
  }
  rejectUnknownKeys(value, new Set(['message', 'replacedBy']), issues, 'deprecation');
  const message = requiredString(value, 'message', issues);
  const replacedBy = optionalString(value, 'replacedBy', issues);
  if (!message) return undefined;
  return { message, ...(replacedBy === undefined ? {} : { replacedBy }) };
}
