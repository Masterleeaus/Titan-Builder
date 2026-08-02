import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserRunStore } from './browser-run-store.js';

test('agent run cannot skip from waiting_for_model to applying', async () => {
  const store = createBrowserRunStore({ persistence: 'memory' });
  const run = await store.create({
    mode: 'agent',
    projectId: 'project-1',
    prompt: 'change x',
  });

  await store.transition(run.id, 'building_context');
  await store.transition(run.id, 'waiting_for_model');

  await assert.rejects(
    () => store.transition(run.id, 'applying'),
    /Invalid run transition/,
  );
});

test('approval revision changes whenever the operation preview changes', async () => {
  const store = createBrowserRunStore({ persistence: 'memory' });
  const run = await store.create({
    mode: 'agent',
    projectId: 'project-1',
    prompt: 'change x',
  });

  await store.setPreview(run.id, [
    {
      id: 'op-1',
      action: 'EDIT_FILE',
      risk: 'WRITE',
      summary: 'Edit first file',
      diff: 'diff',
      requiresExplicitApproval: false,
    },
  ]);
  const first = await store.get(run.id);

  await store.setPreview(run.id, [
    {
      id: 'op-2',
      action: 'EDIT_FILE',
      risk: 'WRITE',
      summary: 'Edit second file',
      diff: 'new diff',
      requiresExplicitApproval: false,
    },
  ]);
  const second = await store.get(run.id);

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.previewRevision, second.previewRevision);
});

test('store returns defensive copies instead of mutable internal records', async () => {
  const store = createBrowserRunStore({ persistence: 'memory' });
  const run = await store.create({
    mode: 'ask',
    projectId: 'project-1',
    prompt: 'explain x',
  });

  const snapshot = await store.get(run.id);
  assert.ok(snapshot);
  snapshot.prompt = 'mutated outside the store';

  const reread = await store.get(run.id);
  assert.equal(reread?.prompt, 'explain x');
});
