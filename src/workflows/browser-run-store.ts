import crypto from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  createBrowserRunStore as createCoreBrowserRunStore,
  getBrowserRunDirectory,
  type BrowserPreparedArtifact,
  type BrowserRunEvent,
  type BrowserRunStore,
  type BrowserRunStoreOptions,
} from './browser-run-store-core.ts';
import {
  BrowserRunIntegrityError,
  createIntegrityBoundPreparedArtifact,
  verifyIntegrityBoundPreparedArtifact,
} from './browser-run-integrity.ts';
import type {
  BrowserRunRecord,
  BrowserRunStatus,
  BrowserRunTransitionPatch,
} from './browser-run-types.js';

export type {
  BrowserPreparedArtifact,
  BrowserRunEvent,
  BrowserRunEventInput,
  BrowserRunStore,
  BrowserRunStoreOptions,
} from './browser-run-store-core.ts';
export { getBrowserRunDirectory } from './browser-run-store-core.ts';

const TERMINAL_STATUSES = new Set<BrowserRunStatus>([
  'completed',
  'rejected',
  'cancelled',
  'failed',
]);

export function createBrowserRunStore(
  options: BrowserRunStoreOptions = {},
): BrowserRunStore {
  const inner = createCoreBrowserRunStore(options);
  const persistence = options.persistence ?? 'disk';
  const runsDir = getBrowserRunDirectory(options);
  const quarantined = new Set<string>();
  const preparedBases = new Map<string, BrowserPreparedArtifact>();

  async function setPrepared(
    runId: string,
    artifact: BrowserPreparedArtifact,
  ): Promise<void> {
    const record = await requireRecord(inner, runId);
    const events = await readAuditEvents(inner, runId, persistence, runsDir);
    const baseArtifact = structuredClone(artifact);
    const envelope = createIntegrityBoundPreparedArtifact(runId, record, baseArtifact, events);
    preparedBases.set(runId, baseArtifact);
    quarantined.delete(runId);
    await inner.setPrepared(runId, envelope as BrowserPreparedArtifact);
  }

  async function getPrepared(runId: string): Promise<BrowserPreparedArtifact | null> {
    const record = await requireRecord(inner, runId);
    if (quarantined.has(runId)) return null;

    let candidate: unknown;
    try {
      candidate = persistence === 'disk'
        ? await readPreparedArtifactFile(runsDir, runId)
        : await inner.getPrepared(runId);
    } catch (error) {
      await quarantinePreparedArtifact(inner, runsDir, runId, persistence, quarantined, error);
      preparedBases.delete(runId);
      return null;
    }
    if (candidate === null) {
      if (requiresPreparedArtifact(record)) {
        await quarantinePreparedArtifact(
          inner,
          runsDir,
          runId,
          persistence,
          quarantined,
          new BrowserRunIntegrityError('Prepared artifact is missing for a recoverable approval run'),
        );
      }
      preparedBases.delete(runId);
      return null;
    }

    try {
      const events = await readAuditEvents(inner, runId, persistence, runsDir);
      const verified = verifyIntegrityBoundPreparedArtifact(candidate, runId, record, events);
      preparedBases.set(runId, structuredClone(verified));
      return verified;
    } catch (error) {
      await quarantinePreparedArtifact(inner, runsDir, runId, persistence, quarantined, error);
      preparedBases.delete(runId);
      return null;
    }
  }

  async function transition(
    runId: string,
    status: BrowserRunStatus,
    patch: BrowserRunTransitionPatch = {},
  ): Promise<BrowserRunRecord> {
    const current = await requireRecord(inner, runId);
    const mustRebindApprovalState = status === 'awaiting_approval'
      && (current.status === 'validating_response' || current.status === 'applying');

    let prepared: BrowserPreparedArtifact | null = null;
    if (mustRebindApprovalState) {
      prepared = preparedBases.get(runId) ?? await getPrepared(runId);
      if (!prepared) {
        throw new BrowserRunIntegrityError(
          'Cannot enter awaiting approval without a verified prepared artifact',
        );
      }
    }

    const updated = await inner.transition(runId, status, patch);
    if (prepared) {
      await setPrepared(runId, prepared);
    }
    if (TERMINAL_STATUSES.has(status)) {
      preparedBases.delete(runId);
    }
    return updated;
  }

  return {
    ...inner,
    transition,
    setPrepared,
    getPrepared,
  };
}

async function requireRecord(
  store: BrowserRunStore,
  runId: string,
): Promise<BrowserRunRecord> {
  const record = await store.get(runId);
  if (!record) throw new BrowserRunIntegrityError(`Browser run not found: ${runId}`);
  return record;
}

function requiresPreparedArtifact(record: BrowserRunRecord): boolean {
  return [
    'awaiting_approval',
    'ready_to_apply',
    'applying',
    'verifying',
  ].includes(record.status);
}

async function readPreparedArtifactFile(
  runsDir: string,
  runId: string,
): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(preparedPath(runsDir, runId), 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new BrowserRunIntegrityError('Prepared artifact is truncated or unreadable', { cause: error });
  }
}

async function readAuditEvents(
  store: BrowserRunStore,
  runId: string,
  persistence: 'memory' | 'disk',
  runsDir: string,
): Promise<BrowserRunEvent[]> {
  if (persistence === 'memory') {
    return [...await store.events(runId, 1000)];
  }

  let content: string;
  try {
    content = await readFile(eventsPath(runsDir, runId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new BrowserRunIntegrityError('Run audit sequence is unreadable', { cause: error });
  }

  const events: BrowserRunEvent[] = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as BrowserRunEvent);
    } catch (error) {
      throw new BrowserRunIntegrityError(`Run audit sequence is truncated at line ${index + 1}`, {
        cause: error,
      });
    }
  }
  return events;
}

async function quarantinePreparedArtifact(
  store: BrowserRunStore,
  runsDir: string,
  runId: string,
  persistence: 'memory' | 'disk',
  quarantined: Set<string>,
  error: unknown,
): Promise<void> {
  quarantined.add(runId);
  const reason = error instanceof Error ? error.message : String(error);

  if (persistence === 'disk') {
    const source = preparedPath(runsDir, runId);
    const destination = `${source}.quarantine.${Date.now()}.${crypto.randomUUID()}.json`;
    try {
      await rename(source, destination);
    } catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== 'ENOENT') throw renameError;
    }
  }

  try {
    await store.appendEvent(runId, {
      type: 'integrity_quarantine',
      summary: 'Prepared run artifact quarantined during recovery',
      details: { reason },
    });
  } catch {
    // Recovery remains fail-closed even when the audit file itself cannot be extended.
  }
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
  if (!/^run-[A-Za-z0-9-]{8,}$/u.test(runId)) {
    throw new BrowserRunIntegrityError(`Invalid browser run id: ${runId}`);
  }
}
