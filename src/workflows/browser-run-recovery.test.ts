import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planOperations } from '../operations/index.ts';
import { createBrowserRunCoordinator } from './browser-run-coordinator.ts';
import { createBrowserRunStore } from './browser-run-store.ts';

async function fixtureDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'openbrowser-run-recovery-'));
}

async function seedAgentRun(directory: string, targetStatus: 'awaiting_approval' | 'ready_to_apply' | 'applying') {
  const projectRoot = await fixtureDirectory();
  const store = createBrowserRunStore({ runsDir: directory });
  const run = await store.create({
    mode: 'agent',
    projectId: 'project-1234567890abcdef',
    prompt: 'Create note',
  });
  await store.transition(run.id, 'building_context');
  await store.transition(run.id, 'waiting_for_model');
  await store.transition(run.id, 'validating_response');
  const plans = await planOperations([
    { action: 'CREATE_FILE', path: 'note.txt', content: 'hello\n' },
  ], projectRoot);
  await store.setPrepared(run.id, {
    conversationId: crypto.randomUUID(),
    rawResponse: '{}',
    operations: plans.map((item) => item.operation),
    previews: plans,
    plannedPreviewRevision: 'a'.repeat(64),
  });
  await store.setPreview(run.id, [{
    id: 'op-1',
    action: 'CREATE_FILE',
    path: 'note.txt',
    risk: 'WRITE',
    summary: 'Create note.txt',
    diff: plans[0].diff,
    requiresExplicitApproval: true,
  }]);
  await store.transition(run.id, 'awaiting_approval');
  if (targetStatus === 'ready_to_apply' || targetStatus === 'applying') {
    await store.transition(run.id, 'ready_to_apply');
  }
  if (targetStatus === 'applying') await store.transition(run.id, 'applying');
  return { run, projectRoot };
}

test('awaiting approval survives restart with prepared data but no approval capability', async () => {
  const directory = await fixtureDirectory();
  const { run } = await seedAgentRun(directory, 'awaiting_approval');
  const restoredStore = createBrowserRunStore({ runsDir: directory });
  const recoverable = await restoredStore.recover();
  const restored = await restoredStore.get(run.id);

  assert.equal(restored?.status, 'awaiting_approval');
  assert.equal('approvalToken' in (restored ?? {}), false);
  assert.equal((await restoredStore.getPrepared(run.id))?.operations.length, 1);
  assert.equal(recoverable.some((item) => item.id === run.id), true);
});

test('ready-to-apply downgrades to approval and applying fails closed after restart', async () => {
  const readyDirectory = await fixtureDirectory();
  const ready = await seedAgentRun(readyDirectory, 'ready_to_apply');
  const readyStore = createBrowserRunStore({ runsDir: readyDirectory });
  await readyStore.recover();
  assert.equal((await readyStore.get(ready.run.id))?.status, 'awaiting_approval');

  const applyingDirectory = await fixtureDirectory();
  const applying = await seedAgentRun(applyingDirectory, 'applying');
  const applyingStore = createBrowserRunStore({ runsDir: applyingDirectory });
  await applyingStore.recover();
  const failed = await applyingStore.get(applying.run.id);
  assert.equal(failed?.status, 'failed');
  assert.match(failed?.error ?? '', /RECOVERY_REVIEW_REQUIRED/);
});

test('audit events are immutable, token-redacted, and bounded', async () => {
  const directory = await fixtureDirectory();
  const store = createBrowserRunStore({ runsDir: directory });
  const run = await store.create({
    mode: 'ask',
    projectId: 'project-1234567890abcdef',
    prompt: 'Explain',
  });
  await store.appendEvent(run.id, {
    type: 'approval_prepared',
    summary: 'x'.repeat(2000),
    details: {
      approvalToken: 'super-secret-token',
      authorization: 'Bearer hidden',
      responseText: 'y'.repeat(5000),
    },
  });
  const events = await store.events(run.id);
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('super-secret-token'), false);
  assert.equal(serialized.includes('Bearer hidden'), false);
  assert.equal(events.at(-1)?.summary.length <= 500, true);
  assert.equal(String(events.at(-1)?.details?.responseText).length <= 1000, true);
  assert.equal(Object.isFrozen(events[0]), true);
});

test('coordinator shutdown waits for detached preparation and persistence', async () => {
  const runsDir = await fixtureDirectory();
  const projectRoot = await fixtureDirectory();
  const store = createBrowserRunStore({ runsDir });
  const project = {
    id: 'project-1234567890abcdef',
    name: 'Fixture',
    root: projectRoot,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let releaseResponse!: (value: string) => void;
  const response = new Promise<string>((resolve) => {
    releaseResponse = resolve;
  });
  const coordinator = createBrowserRunCoordinator({
    store,
    resolveProject: async () => project,
    submitAndWait: async () => response,
  });

  const run = await coordinator.create({
    mode: 'ask',
    projectId: project.id,
    prompt: 'Explain',
  });
  let closed = false;
  const closing = coordinator.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(closed, false);

  releaseResponse('# Complete');
  await closing;
  assert.equal((await store.get(run.id))?.status, 'completed');
});
