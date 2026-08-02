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

export type {
  BrowserPreparedArtifact,
  BrowserRunEvent,
  BrowserRunEventInput,
  BrowserRunStore,
  BrowserRunStoreOptions,
} from './browser-run-store-core.ts';
export { getBrowserRunDirectory } from './browser-run-store-core.ts';

export function createBrowserRunStore(
  options: BrowserRunStoreOptions = {},
): BrowserRunStore {
  const inner = createCoreBrowserRunStore(options);
  const persistence = options.persistence ?? 'disk';
  const runsDir = getBrowserRunDirectory(options);
  const quarantined = new Set<string>();

  return {
    ...inner,

    async setPrepared(runId, artifact) {
      const record = await requireRecord(inner, runId);
      const events = await readAuditEvents(inner, runId, persistence, runsDir);
      const envelope = createIntegrityBoundPreparedArtifact(runId, record, artifact, events);
      quarantined.delete(runId);
      await inner.setPrepared(runId, envelope as BrowserPreparedArtifact);
    },

    async getPrepared(runId) {
      const record = await requireRecord(inner, runId);
      if (quarantined.has(runId)) return null;

      let candidate: unknown;
      try {
        candidate = persistence === 'disk'
          ? await readPreparedArtifactFile(runsDir, runId)
          : await inner.getPrepared(runId);
      } catch (error) {
        await quarantinePreparedArtifact(inner, runsDir, runId, persistence, quarantined, error);
        return null;
      }
      if (candidate === null) return null;

      try {
        const events = await readAuditEvents(inner, runId, persistence, runsDir);
        return verifyIntegrityBoundPreparedArtifact(candidate, runId, record, events);
      } catch (error) {
        await quarantinePreparedArtifact(inner, runsDir, runId, persistence, quarantined, error);
        return null;
      }
    },
  };
}

async function requireRecord(
  store: BrowserRunStore,
  runId: string,
) {
  const record = await store.get(runId);
  if (!record) throw new BrowserRunIntegrityError(`Browser run not found: ${runId}`);
  return record;
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
