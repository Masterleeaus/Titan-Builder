import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import type {
  BrowserOperationPreview,
  BrowserRunListOptions,
  BrowserRunRecord,
  BrowserRunStatus,
  BrowserRunTransitionPatch,
  CreateBrowserRunInput,
} from './browser-run-types.js';

export interface BrowserRunStoreOptions {
  persistence?: 'memory' | 'disk';
  homeDir?: string;
  runsDir?: string;
  maxTerminalRecords?: number;
  retentionMs?: number;
  now?: () => Date;
  idFactory?: () => string;
}

export interface BrowserRunStore {
  create(input: CreateBrowserRunInput): Promise<BrowserRunRecord>;
  get(runId: string): Promise<BrowserRunRecord | null>;
  list(options?: BrowserRunListOptions): Promise<BrowserRunRecord[]>;
  transition(
    runId: string,
    status: BrowserRunStatus,
    patch?: BrowserRunTransitionPatch,
  ): Promise<BrowserRunRecord>;
  setPreview(
    runId: string,
    operations: BrowserOperationPreview[],
  ): Promise<BrowserRunRecord>;
  prune(): Promise<number>;
}

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TERMINAL_RECORDS = 100;
const REGISTERED_PROJECT_ID_PATTERN = /^project-[A-Za-z0-9_-]+$/u;

const TERMINAL_STATUSES = new Set<BrowserRunStatus>([
  'completed',
  'rejected',
  'cancelled',
  'failed',
]);

const RUN_STATUSES = new Set<BrowserRunStatus>([
  'queued',
  'building_context',
  'waiting_for_model',
  'validating_response',
  'awaiting_approval',
  'ready_to_apply',
  'applying',
  'verifying',
  'completed',
  'rejected',
  'cancelled',
  'failed',
]);

const ALLOWED_TRANSITIONS: Record<BrowserRunStatus, BrowserRunStatus[]> = {
  queued: ['building_context', 'cancelled', 'failed'],
  building_context: ['waiting_for_model', 'cancelled', 'failed'],
  waiting_for_model: ['validating_response', 'cancelled', 'failed'],
  validating_response: ['awaiting_approval', 'completed', 'failed'],
  awaiting_approval: ['ready_to_apply', 'rejected', 'cancelled', 'failed'],
  ready_to_apply: ['applying', 'rejected', 'cancelled', 'failed'],
  applying: ['verifying', 'completed', 'failed'],
  verifying: ['completed', 'failed'],
  completed: [],
  rejected: [],
  cancelled: [],
  failed: [],
};

export function createBrowserRunStore(
  options: BrowserRunStoreOptions = {},
): BrowserRunStore {
  const persistence = options.persistence ?? 'disk';
  const records = new Map<string, BrowserRunRecord>();
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => `run-${crypto.randomUUID()}`);
  const retentionMs = normalizePositiveInteger(
    options.retentionMs,
    DEFAULT_RETENTION_MS,
  );
  const maxTerminalRecords = normalizePositiveInteger(
    options.maxTerminalRecords,
    DEFAULT_MAX_TERMINAL_RECORDS,
  );
  const runsDir = getBrowserRunDirectory(options);
  let loadPromise: Promise<void> | null = null;

  async function ensureLoaded(): Promise<void> {
    if (persistence === 'memory') return;
    loadPromise ??= loadPersistedRecords(records, runsDir);
    await loadPromise;
  }

  async function persist(record: BrowserRunRecord): Promise<void> {
    if (persistence === 'memory') return;
    await mkdir(runsDir, { recursive: true });
    const filePath = recordPath(runsDir, record.id);
    const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(tempPath, filePath);
  }

  async function removePersisted(runId: string): Promise<void> {
    if (persistence === 'memory') return;
    try {
      await unlink(recordPath(runsDir, runId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async function requireRecord(runId: string): Promise<BrowserRunRecord> {
    await ensureLoaded();
    const record = records.get(runId);
    if (!record) throw new Error(`Browser run not found: ${runId}`);
    return record;
  }

  const store: BrowserRunStore = {
    async create(input) {
      await ensureLoaded();
      const projectId = normalizeProjectId(input.projectId);
      const prompt = normalizeRequiredText(input.prompt, 'prompt');
      const timestamp = now().toISOString();
      const id = idFactory();
      if (!isSafeRunId(id) || records.has(id)) {
        throw new Error(`Invalid or duplicate browser run id: ${id}`);
      }

      const record: BrowserRunRecord = {
        id,
        mode: input.mode,
        status: 'queued',
        projectId,
        projectName: normalizeOptionalText(input.projectName),
        prompt,
        contextRefs: normalizeContextRefs(input.contextRefs),
        contextBudget: normalizeOptionalPositiveInteger(input.contextBudget),
        provider: input.provider ?? 'auto',
        createdAt: timestamp,
        updatedAt: timestamp,
        verification: input.verificationProfile
          ? { profile: input.verificationProfile, status: 'pending' }
          : undefined,
      };

      records.set(id, record);
      await persist(record);
      await store.prune();
      return cloneRecord(record);
    },

    async get(runId) {
      await ensureLoaded();
      const record = records.get(runId);
      return record ? cloneRecord(record) : null;
    },

    async list(listOptions = {}) {
      await ensureLoaded();
      const limit = normalizeListLimit(listOptions.limit);
      return [...records.values()]
        .filter(
          (record) =>
            !listOptions.projectId || record.projectId === listOptions.projectId,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
        .map(cloneRecord);
    },

    async transition(runId, status, patch = {}) {
      const record = await requireRecord(runId);
      if (!ALLOWED_TRANSITIONS[record.status].includes(status)) {
        throw new Error(
          `Invalid run transition: ${record.status} -> ${status}`,
        );
      }

      const updated: BrowserRunRecord = {
        ...record,
        ...cloneValue(patch),
        status,
        updatedAt: now().toISOString(),
      };
      records.set(runId, updated);
      await persist(updated);
      return cloneRecord(updated);
    },

    async setPreview(runId, operations) {
      const record = await requireRecord(runId);
      if (record.mode !== 'agent') {
        throw new Error('Operation previews are only valid for agent runs');
      }
      const clonedOperations = cloneValue(operations);
      const updated: BrowserRunRecord = {
        ...record,
        operations: clonedOperations,
        previewRevision: createPreviewRevision(clonedOperations),
        updatedAt: now().toISOString(),
      };
      records.set(runId, updated);
      await persist(updated);
      return cloneRecord(updated);
    },

    async prune() {
      await ensureLoaded();
      const cutoff = now().getTime() - retentionMs;
      const terminal = [...records.values()]
        .filter((record) => TERMINAL_STATUSES.has(record.status))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const removals = terminal.filter(
        (record, index) =>
          index >= maxTerminalRecords || Date.parse(record.updatedAt) < cutoff,
      );

      for (const record of removals) {
        records.delete(record.id);
        await removePersisted(record.id);
      }
      return removals.length;
    },
  };

  return store;
}

export function getBrowserRunDirectory(
  options: Pick<BrowserRunStoreOptions, 'homeDir' | 'runsDir'> = {},
): string {
  return (
    options.runsDir ??
    path.join(options.homeDir ?? os.homedir(), '.openbrowser', 'runs')
  );
}

async function loadPersistedRecords(
  records: Map<string, BrowserRunRecord>,
  runsDir: string,
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(runsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(path.join(runsDir, name), 'utf8'),
      );
      if (isBrowserRunRecord(parsed)) {
        records.set(parsed.id, cloneRecord(parsed));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
}

function createPreviewRevision(operations: BrowserOperationPreview[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(operations))
    .digest('hex');
}

function recordPath(runsDir: string, runId: string): string {
  if (!isSafeRunId(runId)) throw new Error(`Invalid browser run id: ${runId}`);
  return path.join(runsDir, `${runId}.json`);
}

function isSafeRunId(value: string): boolean {
  return /^run-[A-Za-z0-9-]{8,}$/u.test(value);
}

function normalizeProjectId(value: string): string {
  const normalized = normalizeRequiredText(value, 'projectId');
  if (!isRegisteredProjectId(normalized)) {
    throw new Error('projectId must be a registered project id');
  }
  return normalized;
}

function isRegisteredProjectId(value: string): boolean {
  return REGISTERED_PROJECT_ID_PATTERN.test(value);
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizeOptionalText(value?: string): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function normalizeContextRefs(values?: string[]): string[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeOptionalPositiveInteger(
  value?: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('contextBudget must be a positive number');
  }
  return Math.round(value);
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function normalizeListLimit(value?: number): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), 500);
}

function cloneRecord(record: BrowserRunRecord): BrowserRunRecord {
  return cloneValue(record);
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function isBrowserRunRecord(value: unknown): value is BrowserRunRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<BrowserRunRecord>;
  return (
    typeof record.id === 'string' &&
    isSafeRunId(record.id) &&
    (record.mode === 'ask' || record.mode === 'agent') &&
    typeof record.status === 'string' &&
    RUN_STATUSES.has(record.status as BrowserRunStatus) &&
    typeof record.projectId === 'string' &&
    isRegisteredProjectId(record.projectId) &&
    typeof record.prompt === 'string' &&
    Array.isArray(record.contextRefs) &&
    typeof record.provider === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  );
}
