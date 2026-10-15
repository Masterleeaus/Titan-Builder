import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { FileOperation } from '../core/types/index.ts';
import type { PlannedOperation } from '../operations/index.ts';
import { reducePlansToBrowserPreviews } from './browser-run-integrity.ts';
import {
  createBrowserRunStore,
  type BrowserPreparedArtifact,
  type BrowserRunStore,
} from './browser-run-store.ts';

const PROJECT_ID = 'project-integrity-recovery';
const PLANNED_REVISION = 'a'.repeat(64);
const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

test('quarantines a prepared artifact when the visible run status is changed independently', async () => {
  const directory = await temporaryDirectory('browser-run-status-tamper-');
  const runId = 'run-integrity-status-tamper';
  const store = createBrowserRunStore({ runsDir: directory, idFactory: () => runId });
  await prepareAwaitingApproval(store);

  const recordPath = path.join(directory, `${runId}.json`);
  const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>;
  record.status = 'completed';
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const restarted = createBrowserRunStore({ runsDir: directory });
  assert.equal(await restarted.getPrepared(runId), null);
  await assertQuarantined(directory, runId);
});

test('quarantines terminal prepared-artifact replay after record status is rewritten', async () => {
  const directory = await temporaryDirectory('browser-run-terminal-replay-');
  const runId = 'run-integrity-terminal-replay';
  const store = createBrowserRunStore({ runsDir: directory, idFactory: () => runId });
  await prepareAwaitingApproval(store);
  await store.appendEvent(runId, {
    type: 'rejected',
    summary: 'Run rejected by user',
  });
  await store.transition(runId, 'rejected');

  const recordPath = path.join(directory, `${runId}.json`);
  const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>;
  record.status = 'awaiting_approval';
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const restarted = createBrowserRunStore({ runsDir: directory });
  const recoverable = await restarted.recover();
  assert.equal(recoverable.some((run) => run.id === runId), true);
  assert.equal(await restarted.getPrepared(runId), null);
  await assertQuarantined(directory, runId);
});

test('fails closed after a crash between the prepared write and approval transition', async () => {
  const directory = await temporaryDirectory('browser-run-prepared-boundary-');
  const runId = 'run-integrity-prepared-boundary';
  const store = createBrowserRunStore({ runsDir: directory, idFactory: () => runId });
  await prepareVisiblePreview(store);
  await store.setPrepared(runId, fixtureArtifact());

  const restarted = createBrowserRunStore({ runsDir: directory });
  const recoverable = await restarted.recover();
  assert.equal((await restarted.get(runId))?.status, 'queued');
  assert.equal(recoverable.some((run) => run.id === runId), true);
  assert.equal(await restarted.getPrepared(runId), null);
  await assertQuarantined(directory, runId);
});

test('fails closed after a crash between approval record persistence and envelope rebinding', async () => {
  const directory = await temporaryDirectory('browser-run-record-boundary-');
  const runId = 'run-integrity-record-boundary';
  const store = createBrowserRunStore({ runsDir: directory, idFactory: () => runId });
  await prepareVisiblePreview(store);
  await store.setPrepared(runId, fixtureArtifact());

  const recordPath = path.join(directory, `${runId}.json`);
  const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>;
  record.status = 'awaiting_approval';
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const restarted = createBrowserRunStore({ runsDir: directory });
  const recoverable = await restarted.recover();
  assert.equal(recoverable.some((run) => run.id === runId), true);
  assert.equal(await restarted.getPrepared(runId), null);
  await assertQuarantined(directory, runId);
});

async function prepareAwaitingApproval(store: BrowserRunStore): Promise<void> {
  const runId = await prepareVisiblePreview(store);
  await store.setPrepared(runId, fixtureArtifact());
  await store.transition(runId, 'awaiting_approval');
}

async function prepareVisiblePreview(store: BrowserRunStore): Promise<string> {
  const run = await store.create({
    mode: 'agent',
    projectId: PROJECT_ID,
    prompt: 'Create the recovery integrity fixture',
  });
  await store.transition(run.id, 'building_context');
  await store.transition(run.id, 'waiting_for_model');
  await store.transition(run.id, 'validating_response');
  const artifact = fixtureArtifact();
  await store.setPreview(run.id, reducePlansToBrowserPreviews(artifact.previews));
  return run.id;
}

function fixtureArtifact(): BrowserPreparedArtifact {
  const operation: FileOperation = {
    action: 'CREATE_FILE',
    path: 'src/recovery-example.ts',
    content: 'export const recovered = true;\n',
  };
  const plan: PlannedOperation = {
    operation,
    absolutePath: '/project/src/recovery-example.ts',
    diff: 'CREATE_FILE src/recovery-example.ts',
    risk: 'WRITE',
    preconditions: [],
    affectedPaths: ['/project/src/recovery-example.ts'],
  };
  return {
    conversationId: 'conversation-integrity-recovery',
    rawResponse: JSON.stringify({ operations: [operation] }),
    operations: [operation],
    previews: [plan],
    plannedPreviewRevision: PLANNED_REVISION,
  };
}

async function assertQuarantined(directory: string, runId: string): Promise<void> {
  await assert.rejects(
    () => readFile(path.join(directory, `${runId}.prepared.json`), 'utf8'),
    { code: 'ENOENT' },
  );
  const files = await readdir(directory);
  assert.ok(files.some((name) => name.startsWith(`${runId}.prepared.json.quarantine.`)));
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
