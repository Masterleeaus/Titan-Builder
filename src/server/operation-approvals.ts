import crypto from 'node:crypto';
import type { PlannedOperation } from '../operations/index.js';

export interface OperationApprovalStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export interface OperationApprovalInput {
  projectRoot: string;
  plans: PlannedOperation[];
}

export interface IssuedOperationApproval {
  token: string;
  expiresAt: number;
  previewHash: string;
  riskSummary: Record<string, number>;
}

interface ApprovalRecord {
  projectRoot: string;
  plans: PlannedOperation[];
  expiresAt: number;
  previewHash: string;
  issuedAt: number;
}

export interface OperationApprovalStore {
  issue(input: OperationApprovalInput): IssuedOperationApproval;
  consume(token: string, projectRoot: string): PlannedOperation[];
  size(): number;
  debugTokenHashes(): string[];
}

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX_ENTRIES = 100;

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

  return {
    issue(input): IssuedOperationApproval {
      const issuedAt = now();
      prune(issuedAt);
      const plans = clonePlans(input.plans);
      const projectRoot = String(input.projectRoot);
      const previewHash = hashPreview(projectRoot, plans);
      const token = `oba_${crypto.randomBytes(32).toString('base64url')}`;
      const tokenHash = hashToken(token);
      const expiresAt = issuedAt + ttlMs;
      records.set(tokenHash, {
        projectRoot,
        plans,
        expiresAt,
        previewHash,
        issuedAt,
      });
      return {
        token,
        expiresAt,
        previewHash,
        riskSummary: summarizeRisk(plans),
      };
    },

    consume(token: string, projectRoot: string): PlannedOperation[] {
      const tokenHash = hashToken(token);
      const record = records.get(tokenHash);
      if (!record) {
        throw new Error('Operation approval token is invalid or already used');
      }
      records.delete(tokenHash);

      const currentTime = now();
      if (record.expiresAt < currentTime) {
        throw new Error('Operation approval token expired');
      }
      if (record.projectRoot !== projectRoot) {
        throw new Error('Operation approval token is bound to a different project root');
      }
      const actualHash = hashPreview(record.projectRoot, record.plans);
      if (!constantTimeHexEqual(actualHash, record.previewHash)) {
        throw new Error('Operation approval preview integrity check failed');
      }
      return clonePlans(record.plans);
    },

    size: () => records.size,
    debugTokenHashes: () => [...records.keys()],
  };
}

function hashPreview(projectRoot: string, plans: PlannedOperation[]): string {
  return crypto
    .createHash('sha256')
    .update(stableSerialize({ version: 1, projectRoot, plans }))
    .digest('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function summarizeRisk(plans: PlannedOperation[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const plan of plans) {
    summary[plan.risk] = (summary[plan.risk] ?? 0) + 1;
  }
  return summary;
}

function clonePlans(plans: PlannedOperation[]): PlannedOperation[] {
  return JSON.parse(JSON.stringify(plans)) as PlannedOperation[];
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

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}
