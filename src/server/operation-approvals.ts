import crypto from 'node:crypto';
import type { PlannedOperation } from '../operations/index.js';
import type { RepositoryIdentity } from '../security/repository-identity.js';

export interface OperationApprovalStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export interface OperationApprovalInput {
  projectRoot: string;
  repositoryIdentity: RepositoryIdentity;
  plans: PlannedOperation[];
  runId?: string;
  conversationId?: string;
  previewRevision?: string;
  selectedOperationIds?: string[];
  gitHead?: string;
  gitBranch?: string;
  gitWorktreeId?: string;
}

export interface OperationApprovalExpectation {
  projectRoot: string;
  repositoryIdentity: RepositoryIdentity;
  runId?: string;
  conversationId?: string;
  previewRevision?: string;
  selectedOperationIds?: string[];
  gitHead?: string;
  gitBranch?: string;
  gitWorktreeId?: string;
}

export interface IssuedOperationApproval {
  token: string;
  expiresAt: number;
  previewHash: string;
  selectedPreviewRevision: string;
  riskSummary: Record<string, number>;
}

export interface OperationApprovalInspection {
  runId: string;
  projectRoot: string;
  repositoryIdentity: RepositoryIdentity;
  conversationId: string;
  previewRevision: string;
  selectedOperationIds: string[];
  selectedPreviewRevision: string;
  plans: PlannedOperation[];
  expiresAt: number;
  gitHead?: string;
  gitBranch?: string;
  gitWorktreeId?: string;
}

interface ApprovalRecord extends OperationApprovalInspection {
  previewHash: string;
  issuedAt: number;
}

export interface OperationApprovalStore {
  issue(input: OperationApprovalInput): IssuedOperationApproval;
  inspect(
    token: string,
    expectation: OperationApprovalExpectation,
  ): OperationApprovalInspection;
  consume(
    token: string,
    expectation: OperationApprovalExpectation,
  ): PlannedOperation[];
  revoke(token: string): void;
  size(): number;
  debugTokenHashes(): string[];
}

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX_ENTRIES = 100;
const LEGACY_RUN_ID = 'legacy-operation-preview';

export function createOperationApprovalStore(
  options: OperationApprovalStoreOptions = {},
): OperationApprovalStore {
  const ttlMs = positiveInteger(options.ttlMs, DEFAULT_TTL_MS);
  const maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const now = options.now ?? Date.now;
  const records = new Map<string, ApprovalRecord>();

  const prune = (currentTime: number): void => {
    for (const [tokenHash, record] of records) {
      if (record.expiresAt < currentTime) {
        records.delete(tokenHash);
      }
    }
    while (records.size >= maxEntries) {
      const oldest = records.keys().next().value as string | undefined;
      if (!oldest) break;
      records.delete(oldest);
    }
  };

  const inspectRecord = (
    token: string,
    expectation: OperationApprovalExpectation,
  ): ApprovalRecord => {
    const tokenHash = hashToken(token);
    const record = records.get(tokenHash);
    if (!record) {
      throw new Error('Operation approval token is invalid or already used');
    }

    const currentTime = now();
    if (record.expiresAt < currentTime) {
      records.delete(tokenHash);
      throw new Error('Operation approval token expired');
    }

    const expected = normalizeExpectation(expectation);
    assertBinding(record, expected);

    const actualHash = hashApprovalBinding(record);
    if (!constantTimeHexEqual(actualHash, record.previewHash)) {
      records.delete(tokenHash);
      throw new Error('Operation approval preview integrity check failed');
    }
    const actualRevision = createOperationPlanRevision(
      record.projectRoot,
      record.plans,
    );
    if (!constantTimeHexEqual(actualRevision, record.selectedPreviewRevision)) {
      records.delete(tokenHash);
      throw new Error('Operation approval selected preview integrity check failed');
    }
    return record;
  };

  return {
    issue(input): IssuedOperationApproval {
      const issuedAt = now();
      prune(issuedAt);
      const plans = clonePlans(input.plans);
      const projectRoot = requireText(input.projectRoot, 'projectRoot');
      const repositoryIdentity = cloneRepositoryIdentity(input.repositoryIdentity);
      if (repositoryIdentity.projectRoot !== projectRoot) {
        throw new Error('Repository identity is bound to a different project root');
      }
      const runId = normalizeOptionalText(input.runId) ?? LEGACY_RUN_ID;
      const conversationId = normalizeOptionalText(input.conversationId) ?? '';
      const selectedOperationIds = normalizeOperationIds(
        input.selectedOperationIds,
        plans.length,
      );
      const selectedPreviewRevision = createOperationPlanRevision(
        projectRoot,
        plans,
      );
      const previewRevision =
        normalizeOptionalText(input.previewRevision) ?? selectedPreviewRevision;
      const expiresAt = issuedAt + ttlMs;
      const gitHead = normalizeOptionalText(input.gitHead);
      const gitBranch = normalizeOptionalText(input.gitBranch);
      const gitWorktreeId = normalizeOptionalText(input.gitWorktreeId);
      const recordBase: OperationApprovalInspection = {
        runId,
        projectRoot,
        repositoryIdentity,
        conversationId,
        previewRevision,
        selectedOperationIds,
        selectedPreviewRevision,
        plans,
        expiresAt,
        gitHead,
        gitBranch,
        gitWorktreeId,
      };
      const previewHash = hashApprovalBinding(recordBase);
      const token = `oba_${crypto.randomBytes(32).toString('base64url')}`;
      records.set(hashToken(token), {
        ...recordBase,
        previewHash,
        issuedAt,
      });
      return {
        token,
        expiresAt,
        previewHash,
        selectedPreviewRevision,
        riskSummary: summarizeRisk(plans),
      };
    },

    inspect(token, expectation): OperationApprovalInspection {
      return cloneInspection(inspectRecord(token, expectation));
    },

    consume(token, expectation): PlannedOperation[] {
      const tokenHash = hashToken(token);
      const record = inspectRecord(token, expectation);
      records.delete(tokenHash);
      return clonePlans(record.plans);
    },

    revoke(token): void {
      records.delete(hashToken(token));
    },

    size: () => records.size,
    debugTokenHashes: () => [...records.keys()],
  };
}

export function createOperationPlanRevision(
  projectRoot: string,
  plans: readonly PlannedOperation[],
): string {
  return crypto
    .createHash('sha256')
    .update(
      stableSerialize({
        version: 1,
        projectRoot: String(projectRoot),
        plans,
      }),
    )
    .digest('hex');
}

function hashApprovalBinding(
  record: Pick<
    OperationApprovalInspection,
    | 'runId'
    | 'projectRoot'
    | 'repositoryIdentity'
    | 'conversationId'
    | 'previewRevision'
    | 'selectedOperationIds'
    | 'selectedPreviewRevision'
    | 'plans'
    | 'expiresAt'
  >,
): string {
  return crypto
    .createHash('sha256')
    .update(
      stableSerialize({
        version: 3,
        runId: record.runId,
        projectRoot: record.projectRoot,
        repositoryIdentity: record.repositoryIdentity,
        conversationId: record.conversationId,
        previewRevision: record.previewRevision,
        selectedOperationIds: record.selectedOperationIds,
        selectedPreviewRevision: record.selectedPreviewRevision,
        plans: record.plans,
        expiresAt: record.expiresAt,
      }),
    )
    .digest('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function summarizeRisk(plans: readonly PlannedOperation[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const plan of plans) {
    summary[plan.risk] = (summary[plan.risk] ?? 0) + 1;
  }
  return summary;
}

function normalizeExpectation(
  expectation: OperationApprovalExpectation,
): OperationApprovalExpectation {
  const repositoryIdentity = cloneRepositoryIdentity(expectation.repositoryIdentity);
  const projectRoot = requireText(expectation.projectRoot, 'projectRoot');
  if (repositoryIdentity.projectRoot !== projectRoot) {
    throw new Error('Repository identity is bound to a different project root');
  }
  return {
    projectRoot,
    repositoryIdentity,
    runId: normalizeOptionalText(expectation.runId),
    conversationId: normalizeOptionalText(expectation.conversationId),
    previewRevision: normalizeOptionalText(expectation.previewRevision),
    selectedOperationIds: expectation.selectedOperationIds
      ? normalizeOperationIds(expectation.selectedOperationIds)
      : undefined,
  };
}

function assertBinding(
  record: ApprovalRecord,
  expectation: OperationApprovalExpectation,
): void {
  if (record.projectRoot !== expectation.projectRoot) {
    throw new Error('Operation approval token is bound to a different project root');
  }
  if (
    stableSerialize(record.repositoryIdentity) !==
    stableSerialize(expectation.repositoryIdentity)
  ) {
    throw new Error('Operation approval token is bound to a different repository identity');
  }
  if (expectation.runId !== undefined && record.runId !== expectation.runId) {
    throw new Error('Operation approval token is bound to a different run');
  }
  if (
    expectation.conversationId !== undefined &&
    record.conversationId !== expectation.conversationId
  ) {
    throw new Error('Operation approval token is bound to a different conversation');
  }
  if (
    expectation.previewRevision !== undefined &&
    record.previewRevision !== expectation.previewRevision
  ) {
    throw new Error('Operation approval token is bound to a different preview revision');
  }
  if (
    expectation.selectedOperationIds !== undefined &&
    stableSerialize(record.selectedOperationIds) !==
      stableSerialize(expectation.selectedOperationIds)
  ) {
    throw new Error('Operation approval token is bound to different selected operations');
  }
}

function normalizeOperationIds(
  values: readonly string[] | undefined,
  planCount?: number,
): string[] {
  const normalized = values
    ? values.map((value) => requireText(value, 'selectedOperationId'))
    : Array.from({ length: planCount ?? 0 }, (_, index) => `op-${index + 1}`);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('selectedOperationIds must be unique');
  }
  if (planCount !== undefined && normalized.length !== planCount) {
    throw new Error('selectedOperationIds must match the approved plan count');
  }
  return normalized;
}

function clonePlans(plans: readonly PlannedOperation[]): PlannedOperation[] {
  return structuredClone(plans) as PlannedOperation[];
}

function cloneRepositoryIdentity(identity: RepositoryIdentity): RepositoryIdentity {
  if (!identity || typeof identity !== 'object') {
    throw new Error('repositoryIdentity is required');
  }
  return structuredClone(identity) as RepositoryIdentity;
}

function cloneInspection(record: ApprovalRecord): OperationApprovalInspection {
  return {
    runId: record.runId,
    projectRoot: record.projectRoot,
    repositoryIdentity: cloneRepositoryIdentity(record.repositoryIdentity),
    conversationId: record.conversationId,
    previewRevision: record.previewRevision,
    selectedOperationIds: [...record.selectedOperationIds],
    selectedPreviewRevision: record.selectedPreviewRevision,
    plans: clonePlans(record.plans),
    expiresAt: record.expiresAt,
  };
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`);
  return `{${entries.join(',')}}`;
}

function requireText(value: string, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizeOptionalText(value?: string): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}
