import crypto from 'node:crypto';
import type { FileOperation } from '../core/types/index.js';
import type { PlannedOperation } from '../operations/index.js';
import { requiresExplicitApproval } from '../tools/registry.ts';
import type {
  BrowserPreparedArtifact,
  BrowserRunEvent,
} from './browser-run-store-core.js';
import type {
  BrowserOperationPreview,
  BrowserRunRecord,
} from './browser-run-types.js';

export const PREPARED_ARTIFACT_SCHEMA_VERSION = 1 as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ENVELOPE_KEYS = [
  'auditRevision',
  'auditSequence',
  'browserPreviewRevision',
  'conversationId',
  'digest',
  'operations',
  'plannedPreviewRevision',
  'previews',
  'projectId',
  'rawResponse',
  'rawResponseDigest',
  'recordRevision',
  'runId',
  'schemaVersion',
  'visibleOperations',
] as const;

export interface IntegrityBoundPreparedArtifact extends BrowserPreparedArtifact {
  schemaVersion: typeof PREPARED_ARTIFACT_SCHEMA_VERSION;
  runId: string;
  projectId: string;
  visibleOperations: BrowserOperationPreview[];
  browserPreviewRevision: string;
  recordRevision: string;
  auditSequence: number;
  auditRevision: string;
  rawResponseDigest: string;
  digest: string;
}

export class BrowserRunIntegrityError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = 'BrowserRunIntegrityError';
  }
}

export function reducePlansToBrowserPreviews(
  plans: readonly PlannedOperation[],
): BrowserOperationPreview[] {
  return plans.map((plan, index) => ({
    id: `op-${index + 1}`,
    action: plan.operation.action,
    path: 'path' in plan.operation ? plan.operation.path : undefined,
    risk: plan.risk,
    summary: plan.diff.split(/\r?\n/u, 1)[0] || plan.operation.action,
    diff: plan.diff,
    requiresExplicitApproval: requiresExplicitApproval(plan.risk),
  }));
}

export function createBrowserPreviewRevision(
  operations: readonly BrowserOperationPreview[],
): string {
  return crypto.createHash('sha256').update(JSON.stringify(operations)).digest('hex');
}

export function createIntegrityBoundPreparedArtifact(
  runId: string,
  record: BrowserRunRecord,
  artifact: BrowserPreparedArtifact,
  auditEvents: readonly BrowserRunEvent[],
): IntegrityBoundPreparedArtifact {
  assertBaseArtifact(artifact);
  assertRunRecordBinding(runId, record);
  assertAuditEvents(runId, auditEvents);
  assertPlanOperationMapping(artifact.operations, artifact.previews);

  const visibleOperations = reducePlansToBrowserPreviews(artifact.previews);
  assertVisiblePreviewBinding(record, visibleOperations);

  const envelopeWithoutDigest = {
    schemaVersion: PREPARED_ARTIFACT_SCHEMA_VERSION,
    runId,
    projectId: record.projectId,
    conversationId: artifact.conversationId,
    rawResponse: artifact.rawResponse,
    operations: clone(artifact.operations),
    previews: clone(artifact.previews),
    plannedPreviewRevision: artifact.plannedPreviewRevision,
    visibleOperations: clone(visibleOperations),
    browserPreviewRevision: createBrowserPreviewRevision(visibleOperations),
    recordRevision: createRecordRevision(record),
    auditSequence: auditEvents.length,
    auditRevision: digestValue(auditEvents),
    rawResponseDigest: digestText(artifact.rawResponse),
  } as const;

  return {
    ...envelopeWithoutDigest,
    digest: digestValue(envelopeWithoutDigest),
  };
}

export function verifyIntegrityBoundPreparedArtifact(
  value: unknown,
  runId: string,
  record: BrowserRunRecord,
  auditEvents: readonly BrowserRunEvent[],
): BrowserPreparedArtifact {
  if (!isIntegrityBoundPreparedArtifact(value)) {
    throw new BrowserRunIntegrityError('Prepared artifact schema is missing, malformed, or unsupported');
  }
  assertRunRecordBinding(runId, record);
  assertAuditEvents(runId, auditEvents);

  if (value.runId !== runId) {
    throw new BrowserRunIntegrityError('Prepared artifact belongs to a different run');
  }
  if (value.projectId !== record.projectId) {
    throw new BrowserRunIntegrityError('Prepared artifact belongs to a different project');
  }
  if (value.rawResponseDigest !== digestText(value.rawResponse)) {
    throw new BrowserRunIntegrityError('Prepared artifact raw response digest does not match');
  }

  assertPlanOperationMapping(value.operations, value.previews);
  const reducedVisibleOperations = reducePlansToBrowserPreviews(value.previews);
  if (!sameValue(reducedVisibleOperations, value.visibleOperations)) {
    throw new BrowserRunIntegrityError('Prepared plans do not reduce to the persisted visible previews');
  }
  assertVisiblePreviewBinding(record, reducedVisibleOperations);

  const browserPreviewRevision = createBrowserPreviewRevision(reducedVisibleOperations);
  if (value.browserPreviewRevision !== browserPreviewRevision) {
    throw new BrowserRunIntegrityError('Prepared artifact browser preview revision does not match');
  }
  if (value.recordRevision !== createRecordRevision(record)) {
    throw new BrowserRunIntegrityError('Prepared artifact record revision does not match the visible run');
  }
  if (auditEvents.length < value.auditSequence) {
    throw new BrowserRunIntegrityError('Prepared artifact audit prefix is missing or truncated');
  }
  const auditPrefix = auditEvents.slice(0, value.auditSequence);
  if (value.auditRevision !== digestValue(auditPrefix)) {
    throw new BrowserRunIntegrityError('Prepared artifact audit sequence binding does not match');
  }

  const { digest, ...withoutDigest } = value;
  if (digest !== digestValue(withoutDigest)) {
    throw new BrowserRunIntegrityError('Prepared artifact content digest does not match');
  }

  return clone({
    conversationId: value.conversationId,
    rawResponse: value.rawResponse,
    operations: value.operations,
    previews: value.previews,
    plannedPreviewRevision: value.plannedPreviewRevision,
  });
}

export function createRecordRevision(record: BrowserRunRecord): string {
  return digestValue({
    id: record.id,
    mode: record.mode,
    status: record.status,
    projectId: record.projectId,
    projectName: record.projectName ?? null,
    prompt: record.prompt,
    contextRefs: record.contextRefs,
    contextBudget: record.contextBudget ?? null,
    provider: record.provider,
    createdAt: record.createdAt,
    operations: record.operations ?? [],
    previewRevision: record.previewRevision ?? null,
  });
}

function assertBaseArtifact(value: BrowserPreparedArtifact): void {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.conversationId !== 'string' ||
    !value.conversationId.trim() ||
    typeof value.rawResponse !== 'string' ||
    !Array.isArray(value.operations) ||
    !Array.isArray(value.previews) ||
    typeof value.plannedPreviewRevision !== 'string' ||
    !SHA256_PATTERN.test(value.plannedPreviewRevision)
  ) {
    throw new BrowserRunIntegrityError('Prepared artifact fields are invalid');
  }
}

function assertRunRecordBinding(runId: string, record: BrowserRunRecord): void {
  if (record.id !== runId) {
    throw new BrowserRunIntegrityError('Visible run record belongs to a different run');
  }
  if (record.mode !== 'agent') {
    throw new BrowserRunIntegrityError('Prepared artifacts are only valid for agent runs');
  }
  if (!record.previewRevision || !Array.isArray(record.operations)) {
    throw new BrowserRunIntegrityError('Visible run preview is unavailable');
  }
}

function assertPlanOperationMapping(
  operations: readonly FileOperation[],
  plans: readonly PlannedOperation[],
): void {
  if (operations.length !== plans.length) {
    throw new BrowserRunIntegrityError('Prepared operations and plans have different lengths');
  }
  const plannedOperations = plans.map((plan) => plan.operation);
  if (!sameValue(operations, plannedOperations)) {
    throw new BrowserRunIntegrityError('Prepared operations do not map exactly to the persisted plans');
  }
}

function assertVisiblePreviewBinding(
  record: BrowserRunRecord,
  reducedVisibleOperations: readonly BrowserOperationPreview[],
): void {
  if (!sameValue(record.operations ?? [], reducedVisibleOperations)) {
    throw new BrowserRunIntegrityError('Prepared plans do not match the visible run operations');
  }
  const revision = createBrowserPreviewRevision(reducedVisibleOperations);
  if (record.previewRevision !== revision) {
    throw new BrowserRunIntegrityError('Visible run preview revision does not match its operations');
  }
}

function assertAuditEvents(runId: string, events: readonly BrowserRunEvent[]): void {
  const ids = new Set<string>();
  for (const event of events) {
    if (
      !event ||
      typeof event !== 'object' ||
      typeof event.id !== 'string' ||
      !event.id ||
      event.runId !== runId ||
      typeof event.at !== 'string' ||
      !event.at ||
      typeof event.type !== 'string' ||
      !event.type ||
      typeof event.summary !== 'string'
    ) {
      throw new BrowserRunIntegrityError('Run audit sequence contains an invalid or swapped event');
    }
    if (ids.has(event.id)) {
      throw new BrowserRunIntegrityError('Run audit sequence contains a duplicated event');
    }
    ids.add(event.id);
  }
}

function isIntegrityBoundPreparedArtifact(
  value: unknown,
): value is IntegrityBoundPreparedArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const artifact = value as Partial<IntegrityBoundPreparedArtifact>;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  if (!sameValue(keys, [...ENVELOPE_KEYS].sort())) return false;
  return (
    artifact.schemaVersion === PREPARED_ARTIFACT_SCHEMA_VERSION &&
    typeof artifact.runId === 'string' &&
    typeof artifact.projectId === 'string' &&
    typeof artifact.conversationId === 'string' &&
    typeof artifact.rawResponse === 'string' &&
    Array.isArray(artifact.operations) &&
    Array.isArray(artifact.previews) &&
    typeof artifact.plannedPreviewRevision === 'string' &&
    SHA256_PATTERN.test(artifact.plannedPreviewRevision) &&
    Array.isArray(artifact.visibleOperations) &&
    typeof artifact.browserPreviewRevision === 'string' &&
    SHA256_PATTERN.test(artifact.browserPreviewRevision) &&
    typeof artifact.recordRevision === 'string' &&
    SHA256_PATTERN.test(artifact.recordRevision) &&
    Number.isInteger(artifact.auditSequence) &&
    Number(artifact.auditSequence) >= 0 &&
    typeof artifact.auditRevision === 'string' &&
    SHA256_PATTERN.test(artifact.auditRevision) &&
    typeof artifact.rawResponseDigest === 'string' &&
    SHA256_PATTERN.test(artifact.rawResponseDigest) &&
    typeof artifact.digest === 'string' &&
    SHA256_PATTERN.test(artifact.digest)
  );
}

function digestText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function digestValue(value: unknown): string {
  return digestText(canonicalJson(value));
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
