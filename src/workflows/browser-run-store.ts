import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import type { FileOperation } from '../core/types/index.js';
import type { PlannedOperation } from '../operations/index.js';
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

export interface BrowserPreparedArtifact {
  conversationId: string;
  rawResponse: string;
  operations: FileOperation[];
  previews: PlannedOperation[];
  plannedPreviewRevision: string;
}

export interface BrowserRunEventInput {
  type: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface BrowserRunEvent extends BrowserRunEventInput {
  id: string;
  runId: string;
  at: string;
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
  setPrepared(runId: string, artifact: BrowserPreparedArtifact): Promise<void>;
  getPrepared(runId: string): Promise<BrowserPreparedArtifact | null>;
  appendEvent(runId: string, event: BrowserRunEventInput): Promise<BrowserRunEvent>;
  events(runId: string, limit?: number): Promise<readonly BrowserRunEvent[]>;
  recover(): Promise<BrowserRunRecord[]>;
  prune(): Promise<number>;
}

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TERMINAL_RECORDS = 100;
const REGISTERED_PROJECT_ID_PATTERN = /^project-[A-Za-z0-9_-]+$/u;
const REDACTED_KEYS = /token|authorization|secret|password|cookie/iu;

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
  ready_to_apply: ['applying', 'awaiting_approval', 'rejected', 'cancelled', 'failed'],
  applying: ['verifying', 'completed', 'awaiting_approval', 'failed'],
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
  const preparedArtifacts = new Map<string, BrowserPreparedArtifact>();
  const eventRecords = new Map<string, BrowserRunEvent[]>();
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => `run-${crypto.randomUUID()}`);
  const retentionMs = normalizePositiveInteger(options.retentionMs, DEFAULT_RETENTION_MS);
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
    await writeAtomicJson(recordPath(runsDir, record.id), record);
  }

  async function removePersisted(runId: string): Promise<void> {
    if (persistence === 'memory') return;
    for (const filePath of [
      recordPath(runsDir, runId),
      preparedPath(runsDir, runId),
      eventsPath(runsDir, runId),
    ]) {
      try {
        await unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
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
      await store.appendEvent(id, {
        type: 'run_created',
        summary: `${record.mode} run created`,
        details: { projectId: record.projectId, provider: record.provider },
      });
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
        .filter((record) => !listOptions.projectId || record.projectId === listOptions.projectId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
        .map(cloneRecord);
    },

    async transition(runId, status, patch = {}) {
      const record = await requireRecord(runId);
      if (!ALLOWED_TRANSITIONS[record.status].includes(status)) {
        throw new Error(`Invalid run transition: ${record.status} -> ${status}`);
      }
      const previousStatus = record.status;
      const updated: BrowserRunRecord = {
        ...record,
        ...cloneValue(patch),
        status,
        updatedAt: now().toISOString(),
      };
      records.set(runId, updated);
      await persist(updated);
      await store.appendEvent(runId, {
        type: 'status_changed',
        summary: `${previousStatus} -> ${status}`,
        details: { previousStatus, status, error: patch.error },
      });
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
      await store.appendEvent(runId, {
        type: 'preview_generated',
        summary: `${clonedOperations.length} operation preview(s) generated`,
        details: {
          previewRevision: updated.previewRevision,
          risks: clonedOperations.map((item) => item.risk),
        },
      });
      return cloneRecord(updated);
    },

    async setPrepared(runId, artifact) {
      await requireRecord(runId);
      const normalized = normalizePreparedArtifact(artifact);
      preparedArtifacts.set(runId, normalized);
      if (persistence !== 'memory') {
        await writeAtomicJson(preparedPath(runsDir, runId), normalized);
      }
    },

    async getPrepared(runId) {
      await requireRecord(runId);
      const cached = preparedArtifacts.get(runId);
      if (cached) return cloneValue(cached);
      if (persistence === 'memory') return null;
      try {
        const parsed = JSON.parse(await readFile(preparedPath(runsDir, runId), 'utf8')) as unknown;
        if (!isPreparedArtifact(parsed)) return null;
        const normalized = normalizePreparedArtifact(parsed);
        preparedArtifacts.set(runId, normalized);
        return cloneValue(normalized);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        if (error instanceof SyntaxError) return null;
        throw error;
      }
    },

    async appendEvent(runId, event) {
      await requireRecord(runId);
      const normalized: BrowserRunEvent = {
        id: `evt-${crypto.randomUUID()}`,
        runId,
        at: now().toISOString(),
        type: normalizeRequiredText(event.type, 'event.type').slice(0, 100),
        summary: normalizeRequiredText(event.summary, 'event.summary').slice(0, 500),
        details: sanitizeValue(event.details ?? {}) as Record<string, unknown>,
      };
      const existing = eventRecords.get(runId) ?? [];
      existing.push(normalized);
      eventRecords.set(runId, existing);
      if (persistence !== 'memory') {
        await mkdir(runsDir, { recursive: true, mode: 0o700 });
        const eventPath = eventsPath(runsDir, runId);
        try {
          await appendFile(eventPath, `${JSON.stringify(normalized)}\n`, 'utf8');
          if (process.platform !== 'win32') {
            await chmod(eventPath, 0o600);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
          await writeFile(eventPath, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
        }
      }
      return freezeClone(normalized);
    },

    async events(runId, limit = 200) {
      await requireRecord(runId);
      let items = eventRecords.get(runId);
      if (!items && persistence !== 'memory') {
        items = await loadEvents(eventsPath(runsDir, runId));
        eventRecords.set(runId, items);
      }
      const count = normalizeEventLimit(limit);
      return freezeClone((items ?? []).slice(-count));
    },

    async recover() {
      await ensureLoaded();
      const recoverable: BrowserRunRecord[] = [];
      for (const current of [...records.values()]) {
        if (TERMINAL_STATUSES.has(current.status)) continue;
        let updated = current;
        let recoverySummary = '';
        if (['building_context', 'waiting_for_model', 'validating_response'].includes(current.status)) {
          updated = {
            ...current,
            status: 'queued',
            updatedAt: now().toISOString(),
          };
          recoverySummary = `${current.status} reset to queued for safe recovery`;
        } else if (current.status === 'ready_to_apply') {
          updated = {
            ...current,
            status: 'awaiting_approval',
            updatedAt: now().toISOString(),
          };
          recoverySummary = 'ready_to_apply downgraded to awaiting_approval; approval capability discarded';
        } else if (current.status === 'applying' || current.status === 'verifying') {
          updated = {
            ...current,
            status: 'failed',
            error: 'RECOVERY_REVIEW_REQUIRED: service restarted after apply began; writes were not replayed',
            updatedAt: now().toISOString(),
          };
          recoverySummary = `${current.status} marked failed without replay`;
        }

        if (updated !== current) {
          records.set(updated.id, updated);
          await persist(updated);
          await store.appendEvent(updated.id, {
            type: 'recovery',
            summary: recoverySummary,
            details: { previousStatus: current.status, status: updated.status },
          });
        }
        if (updated.status === 'queued' || updated.status === 'awaiting_approval') {
          recoverable.push(cloneRecord(updated));
        }
      }
      return recoverable;
    },

    async prune() {
      await ensureLoaded();
      const cutoff = now().getTime() - retentionMs;
      const terminal = [...records.values()]
        .filter((record) => TERMINAL_STATUSES.has(record.status))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const removals = terminal.filter(
        (record, index) => index >= maxTerminalRecords || Date.parse(record.updatedAt) < cutoff,
      );
      for (const record of removals) {
        records.delete(record.id);
        preparedArtifacts.delete(record.id);
        eventRecords.delete(record.id);
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
  return options.runsDir ?? path.join(options.homeDir ?? os.homedir(), '.openbrowser', 'runs');
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
  for (const name of names.filter((item) => /^run-.+\.json$/u.test(item)).sort()) {
    if (name.endsWith('.prepared.json')) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(path.join(runsDir, name), 'utf8'));
      if (isBrowserRunRecord(parsed)) records.set(parsed.id, cloneRecord(parsed));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
}

async function loadEvents(filePath: string): Promise<BrowserRunEvent[]> {
  try {
    const content = await readFile(filePath, 'utf8');
    return content
      .split(/\r?\n/u)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const value = JSON.parse(line) as BrowserRunEvent;
          return value?.id && value?.runId && value?.type ? [value] : [];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeAtomicJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, filePath);
  if (process.platform !== 'win32') {
    await chmod(filePath, 0o600);
  }
}

function createPreviewRevision(operations: BrowserOperationPreview[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(operations)).digest('hex');
}

function recordPath(runsDir: string, runId: string): string {
  assertSafeRunId(runId);
  return path.join(runsDir, `${runId}.json`);
}

function preparedPath(runsDir: string, runId: string): string {
  assertSafeRunId(runId);
  return path.join(runsDir, `${runId}.prepared.json`);
}

function eventsPath(runsDir: string, runId: string): string {
  assertSafeRunId(runId);
  return path.join(runsDir, `${runId}.events.jsonl`);
}

function assertSafeRunId(runId: string): void {
  if (!isSafeRunId(runId)) throw new Error(`Invalid browser run id: ${runId}`);
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
  return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeOptionalPositiveInteger(value?: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('contextBudget must be a positive number');
  }
  return Math.round(value);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function normalizeListLimit(value?: number): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), 500);
}

function normalizeEventLimit(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return 200;
  return Math.max(1, Math.min(1000, Math.round(value)));
}

function normalizePreparedArtifact(value: BrowserPreparedArtifact): BrowserPreparedArtifact {
  if (!isPreparedArtifact(value)) throw new Error('Invalid prepared browser run artifact');
  return cloneValue(value);
}

function isPreparedArtifact(value: unknown): value is BrowserPreparedArtifact {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as Partial<BrowserPreparedArtifact>;
  return (
    typeof artifact.conversationId === 'string' &&
    typeof artifact.rawResponse === 'string' &&
    Array.isArray(artifact.operations) &&
    Array.isArray(artifact.previews) &&
    typeof artifact.plannedPreviewRevision === 'string'
  );
}

function sanitizeValue(value: unknown, key = ''): unknown {
  if (REDACTED_KEYS.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return value.slice(0, 1000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)]),
    );
  }
  return value;
}

function cloneRecord(record: BrowserRunRecord): BrowserRunRecord {
  return cloneValue(record);
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function freezeClone<T>(value: T): T {
  return deepFreeze(cloneValue(value));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
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
