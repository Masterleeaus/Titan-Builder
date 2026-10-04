import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { FileOperation } from '../core/types/index.ts';
import type { PlannedOperation } from '../operations/index.ts';
import {
  createBrowserRunStore,
  type BrowserPreparedArtifact,
  type BrowserRunStore,
} from './browser-run-store.ts';
import { reducePlansToBrowserPreviews } from './browser-run-integrity.ts';

const PROJECT_ID = 'project-integrity-fixture';
const PLANNED_REVISION = 'a'.repeat(64);

interface PreparedFixture {
  directory: string;
  runId: string;
  store: BrowserRunStore;
  artifactPath: string;
  recordPath: string;
  eventsPath: string;
}

const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

test('persists a versioned aggregate and restores only the matching visible preview', async () => {
  const fixture = await prepareFixture('run-integrity-valid');
  const persisted = JSON.parse(await readFile(fixture.artifactPath, 'utf8')) as Record<string, unknown>;

  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.runId, fixture.runId);
  assert.match(String(persisted.digest), /^[a-f0-9]{64}$/u);
  assert.match(String(persisted.recordRevision), /^[a-f0-9]{64}$/u);
  assert.match(String(persisted.auditRevision), /^[a-f0-9]{64}$/u);

  const restarted = createBrowserRunStore({ runsDir: fixture.directory });
  const recovered = await restarted.getPrepared(fixture.runId);
  assert.ok(recovered);
  assert.equal(recovered.conversationId, 'conversation-integrity');
  assert.deepEqual(recovered.operations, fixtureArtifact().operations);
  assert.deepEqual(recovered.previews, fixtureArtifact().previews);
});

test('quarantines independent mutations to every integrity-bound top-level field', async (t) => {
  const mutations: Array<[string, (value: Record<string, unknown>) => void]> = [
    ['schemaVersion', (value) => { value.schemaVersion = 2; }],
    ['runId', (value) => { value.runId = 'run-integrity-other'; }],
    ['projectId', (value) => { value.projectId = 'project-other'; }],
    ['conversationId', (value) => { value.conversationId = 'conversation-other'; }],
    ['rawResponse', (value) => { value.rawResponse = '{"operations":[]}'; }],
    ['operations', (value) => {
      (value.operations as Array<Record<string, unknown>>)[0] = {
        action: 'DELETE_FILE',
        path: 'src/example.ts',
      };
    }],
    ['previews', (value) => {
      (value.previews as Array<Record<string, unknown>>)[0].diff = 'tampered diff';
    }],
    ['plannedPreviewRevision', (value) => { value.plannedPreviewRevision = 'b'.repeat(64); }],
    ['visibleOperations', (value) => {
      (value.visibleOperations as Array<Record<string, unknown>>)[0].summary = 'tampered summary';
    }],
    ['browserPreviewRevision', (value) => { value.browserPreviewRevision = 'b'.repeat(64); }],
    ['recordRevision', (value) => { value.recordRevision = 'b'.repeat(64); }],
    ['auditSequence', (value) => { value.auditSequence = Number(value.auditSequence) + 1; }],
    ['auditRevision', (value) => { value.auditRevision = 'b'.repeat(64); }],
    ['rawResponseDigest', (value) => { value.rawResponseDigest = 'b'.repeat(64); }],
    ['digest', (value) => { value.digest = 'b'.repeat(64); }],
  ];

  for (const [field, mutate] of mutations) {
    await t.test(field, async () => {
      const fixture = await prepareFixture(`run-integrity-${field.toLowerCase()}`);
      const value = JSON.parse(await readFile(fixture.artifactPath, 'utf8')) as Record<string, unknown>;
      mutate(value);
      await writeFile(fixture.artifactPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

      const restarted = createBrowserRunStore({ runsDir: fixture.directory });
      assert.equal(await restarted.getPrepared(fixture.runId), null);
      await assert.rejects(() => readFile(fixture.artifactPath, 'utf8'), { code: 'ENOENT' });
      const files = await readdir(fixture.directory);
      assert.ok(files.some((name) => name.startsWith(`${fixture.runId}.prepared.json.quarantine.`)));
    });
  }
});

test('quarantines prepared artifacts swapped between runs', async () => {
  const directory = await temporaryDirectory('browser-run-swap-');
  const runIds = ['run-integrity-swap-a', 'run-integrity-swap-b'];
  let index = 0;
  const store = createBrowserRunStore({
    runsDir: directory,
    idFactory: () => runIds[index++] ?? `run-integrity-extra-${index}`,
  });
  await prepareRun(store);
  await prepareRun(store);

  const firstPath = path.join(directory, `${runIds[0]}.prepared.json`);
  const secondPath = path.join(directory, `${runIds[1]}.prepared.json`);
  const [first, second] = await Promise.all([
    readFile(firstPath, 'utf8'),
    readFile(secondPath, 'utf8'),
  ]);
  await Promise.all([
    writeFile(firstPath, second, 'utf8'),
    writeFile(secondPath, first, 'utf8'),
  ]);

  const restarted = createBrowserRunStore({ runsDir: directory });
  assert.equal(await restarted.getPrepared(runIds[0]), null);
  assert.equal(await restarted.getPrepared(runIds[1]), null);
});

test('quarantines record, audit-prefix, duplicate-event, and truncation mismatches', async (t) => {
  await t.test('visible record mutation', async () => {
    const fixture = await prepareFixture('run-integrity-record');
    const record = JSON.parse(await readFile(fixture.recordPath, 'utf8')) as Record<string, unknown>;
    (record.operations as Array<Record<string, unknown>>)[0].summary = 'different visible operation';
    await writeFile(fixture.recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

    const restarted = createBrowserRunStore({ runsDir: fixture.directory });
    assert.equal(await restarted.getPrepared(fixture.runId), null);
  });

  await t.test('audit event mutation', async () => {
    const fixture = await prepareFixture('run-integrity-audit');
    const lines = (await readFile(fixture.eventsPath, 'utf8')).trimEnd().split('\n');
    const event = JSON.parse(lines[0]) as Record<string, unknown>;
    event.summary = 'tampered audit event';
    lines[0] = JSON.stringify(event);
    await writeFile(fixture.eventsPath, `${lines.join('\n')}\n`, 'utf8');

    const restarted = createBrowserRunStore({ runsDir: fixture.directory });
    assert.equal(await restarted.getPrepared(fixture.runId), null);
  });

  await t.test('duplicated audit event', async () => {
    const fixture = await prepareFixture('run-integrity-duplicate');
    const content = await readFile(fixture.eventsPath, 'utf8');
    const first = content.split('\n')[0];
    await writeFile(fixture.eventsPath, `${first}\n${content}`, 'utf8');

    const restarted = createBrowserRunStore({ runsDir: fixture.directory });
    assert.equal(await restarted.getPrepared(fixture.runId), null);
  });

  await t.test('truncated prepared write', async () => {
    const fixture = await prepareFixture('run-integrity-truncated');
    await writeFile(fixture.artifactPath, '{"schemaVersion":1', 'utf8');

    const restarted = createBrowserRunStore({ runsDir: fixture.directory });
    assert.equal(await restarted.getPrepared(fixture.runId), null);
  });

  await t.test('missing prepared write', async () => {
    const fixture = await prepareFixture('run-integrity-missing');
    await unlink(fixture.artifactPath);

    const restarted = createBrowserRunStore({ runsDir: fixture.directory });
    assert.equal(await restarted.getPrepared(fixture.runId), null);
    const events = await restarted.events(fixture.runId);
    assert.equal(events.at(-1)?.type, 'integrity_quarantine');
    assert.match(String(events.at(-1)?.details?.reason), /missing/u);
  });
});

async function prepareFixture(runId: string): Promise<PreparedFixture> {
  const directory = await temporaryDirectory('browser-run-integrity-');
  const store = createBrowserRunStore({
    runsDir: directory,
    idFactory: () => runId,
  });
  await prepareRun(store);
  return {
    directory,
    runId,
    store,
    artifactPath: path.join(directory, `${runId}.prepared.json`),
    recordPath: path.join(directory, `${runId}.json`),
    eventsPath: path.join(directory, `${runId}.events.jsonl`),
  };
}

async function prepareRun(store: BrowserRunStore): Promise<string> {
  const run = await store.create({
    mode: 'agent',
    projectId: PROJECT_ID,
    prompt: 'Create the integrity fixture',
  });
  const artifact = fixtureArtifact();
  await store.setPreview(run.id, reducePlansToBrowserPreviews(artifact.previews));
  await store.setPrepared(run.id, artifact);
  await store.transition(run.id, 'building_context');
  await store.transition(run.id, 'waiting_for_model');
  await store.transition(run.id, 'validating_response');
  await store.transition(run.id, 'awaiting_approval');
  return run.id;
}

function fixtureArtifact(): BrowserPreparedArtifact {
  const operation: FileOperation = {
    action: 'CREATE_FILE',
    path: 'src/example.ts',
    content: 'export const value = 1;\n',
  };
  const plan: PlannedOperation = {
    operation,
    absolutePath: '/project/src/example.ts',
    diff: 'CREATE_FILE src/example.ts',
    risk: 'WRITE',
    preconditions: [],
    affectedPaths: ['/project/src/example.ts'],
  };
  return {
    conversationId: 'conversation-integrity',
    rawResponse: JSON.stringify({ operations: [operation] }),
    operations: [operation],
    previews: [plan],
    plannedPreviewRevision: PLANNED_REVISION,
  };
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
