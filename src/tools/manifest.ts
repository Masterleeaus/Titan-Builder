import { z } from 'zod';

export const TOOL_MANIFEST_SCHEMA_VERSION = '1' as const;
export const TOOL_STATUSES = ['experimental', 'stable', 'deprecated'] as const;
export const TOOL_RISKS = [
  'READ',
  'SAFE_EXECUTION',
  'WRITE',
  'NETWORK_WRITE',
  'ARBITRARY_EXECUTION',
  'DESTRUCTIVE',
  'PUBLISH',
] as const;
export const TOOL_APPROVAL_MODES = ['none', 'explicit', 'policy'] as const;
export const TOOL_PERMISSIONS = [
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
export const TOOL_PLATFORMS = ['linux', 'windows', 'macos', 'browser'] as const;

const canonicalId = /^titan\.tool\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const runtimeId = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const semver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const nodeRange = /^(?:>=|>|=|<=|<|\^|~)?\s*\d+(?:\.\d+){0,2}(?:\s*[-|]{1,2}\s*\d+(?:\.\d+){0,2})?$/u;
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const highSideEffectRisks = new Set(['NETWORK_WRITE', 'ARBITRARY_EXECUTION', 'DESTRUCTIVE', 'PUBLISH']);

const nonEmptyText = z.string().trim().min(1).max(500);
const nonEmptyList = z.array(nonEmptyText).min(1);
const uniqueList = <T extends z.ZodTypeAny>(schema: T, message: string) =>
  z.array(schema).default([]).superRefine((values, context) => {
    if (new Set(values.map((value) => JSON.stringify(value))).size !== values.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  });

const jsonObjectSchema = z.record(z.unknown()).superRefine((value, context) => {
  if (value.type !== 'object') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'JSON schema must declare type "object".' });
  }
});

const exampleSchema = z.object({
  title: z.string().trim().min(1).max(120),
  tool: z.string().regex(runtimeId),
  args: z.array(z.string().max(300)).max(20).default([]),
  path: z.string().trim().min(1).max(300).optional(),
}).strict();

const manifestSchema = z.object({
  schemaVersion: z.literal(TOOL_MANIFEST_SCHEMA_VERSION),
  id: z.string().regex(canonicalId, 'Tool ID must be a canonical titan.tool.* identifier.'),
  runtimeId: z.string().regex(runtimeId, 'Runtime ID must use lowercase dot/dash-separated segments.'),
  aliases: uniqueList(z.string().regex(runtimeId), 'Tool aliases must be unique.').optional(),
  name: z.string().trim().min(1).max(120),
  purpose: nonEmptyText,
  category: z.string().regex(slug, 'Category must be a lowercase kebab-case slug.'),
  responsibilities: nonEmptyList,
  inputs: jsonObjectSchema,
  outputs: jsonObjectSchema,
  permissions: uniqueList(z.enum(TOOL_PERMISSIONS), 'Tool permissions must be unique.'),
  dependencies: uniqueList(z.string().regex(runtimeId), 'Tool dependencies must be unique.'),
  servicesUsed: uniqueList(z.string().regex(slug), 'Tool services must be unique.'),
  commands: nonEmptyList,
  configuration: nonEmptyList,
  securityConsiderations: nonEmptyList,
  failureHandling: nonEmptyList,
  validation: nonEmptyList,
  tests: nonEmptyList,
  documentation: nonEmptyList,
  examples: z.array(exampleSchema).min(1),
  version: z.string().regex(semver, 'Version must use semantic versioning.'),
  status: z.enum(TOOL_STATUSES),
  owner: z.string().trim().min(1).max(120),
  risk: z.enum(TOOL_RISKS),
  approval: z.enum(TOOL_APPROVAL_MODES),
  compatibility: z.object({
    minTitanVersion: z.string().regex(semver).optional(),
    node: z.string().regex(nodeRange).optional(),
    platforms: uniqueList(z.enum(TOOL_PLATFORMS), 'Compatibility platforms must be unique.').optional(),
  }).strict(),
  knowledge: z.object({
    summary: nonEmptyText,
    keywords: uniqueList(z.string().regex(slug), 'Knowledge keywords must be unique.'),
    relatedTools: uniqueList(z.string().regex(runtimeId), 'Related tools must be unique.'),
    relatedAgents: uniqueList(z.string().trim().min(1), 'Related agents must be unique.'),
    relatedSkills: uniqueList(z.string().trim().min(1), 'Related skills must be unique.'),
    relatedWorkflows: uniqueList(z.string().trim().min(1), 'Related workflows must be unique.'),
  }).strict(),
  deprecation: z.object({
    message: nonEmptyText,
    replacedBy: z.string().regex(runtimeId).optional(),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  const aliases = value.aliases ?? [];
  if (aliases.includes(value.runtimeId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['aliases'],
      message: 'A tool cannot alias its runtime ID.',
    });
  }
  if (value.dependencies.includes(value.runtimeId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dependencies'],
      message: 'A tool cannot depend on itself.',
    });
  }
  if (highSideEffectRisks.has(value.risk) && value.approval === 'none') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approval'],
      message: `${value.risk} tools require explicit or policy approval.`,
    });
  }
  if (value.status === 'deprecated' && !value.deprecation) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['deprecation'],
      message: 'Deprecated tools require deprecation metadata.',
    });
  }
  for (const example of value.examples) {
    if (example.tool !== value.runtimeId && !aliases.includes(example.tool)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['examples'],
        message: `Example tool ${example.tool} must use the runtime ID or a declared alias.`,
      });
    }
  }
});

export type TitanToolManifest = z.infer<typeof manifestSchema>;
export type ToolRisk = z.infer<typeof manifestSchema>['risk'];

export interface ToolManifestIssue {
  path: string;
  message: string;
}

export type ToolManifestValidationResult =
  | { success: true; data: TitanToolManifest; issues: [] }
  | { success: false; issues: ToolManifestIssue[] };

export function validateToolManifest(input: unknown): ToolManifestValidationResult {
  const result = manifestSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: deepFreeze(result.data), issues: [] };
  }
  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : '$',
      message: issue.message,
    })),
  };
}

export function parseToolManifest(input: unknown): TitanToolManifest {
  const result = validateToolManifest(input);
  if (result.success) {
    return result.data;
  }
  const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
  throw new Error(`Invalid Titan tool manifest: ${detail}`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}
