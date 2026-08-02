import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCreateRunPayload,
  buildOperationSelection,
  createAgentWorkspaceController,
  parseBridgeError,
  reduceRunViewState,
} from './agent-workspace.js';

test('agent payload requires an explicit registered project', () => {
  assert.throws(
    () => buildCreateRunPayload({ mode: 'agent', prompt: 'Fix it', projectId: '' }),
    /project/i,
  );
  assert.deepEqual(
    buildCreateRunPayload({
      mode: 'agent',
      prompt: ' Fix it ',
      projectId: 'project-1234567890abcdef',
      contextRefs: 'src\nREADME.md',
      contextBudget: '60000',
      provider: 'chatgpt',
      verificationProfile: 'standard',
    }),
    {
      mode: 'agent',
      prompt: 'Fix it',
      projectId: 'project-1234567890abcdef',
      contextRefs: ['src', 'README.md'],
      contextBudget: 60000,
      provider: 'chatgpt',
      verificationProfile: 'standard',
    },
  );
});

test('awaiting approval exposes review controls but not final apply', () => {
  const state = reduceRunViewState({}, {
    id: 'run-1',
    status: 'awaiting_approval',
    operations: [{ id: 'op-1', risk: 'WRITE', diff: 'diff', requiresExplicitApproval: false }],
  });
  assert.equal(state.showReview, true);
  assert.equal(state.showApply, false);
  assert.equal(state.terminal, false);
});

test('high-risk operation is unselected until separately approved', () => {
  const model = buildOperationSelection([
    { id: 'safe', risk: 'WRITE', requiresExplicitApproval: false },
    { id: 'danger', risk: 'DESTRUCTIVE', requiresExplicitApproval: true },
  ]);
  assert.equal(model.selected.has('safe'), true);
  assert.equal(model.selected.has('danger'), false);
  assert.equal(model.highRisk.has('danger'), true);
});

test('serialized stale errors preserve the latest server snapshot', () => {
  const snapshot = {
    id: 'run-1',
    status: 'awaiting_approval',
    previewRevision: 'next',
    operations: [{ id: 'op-2', risk: 'WRITE' }],
  };
  const error = parseBridgeError(`Bridge request failed (409): ${JSON.stringify({
    error: 'STALE_PREVIEW',
    message: 'Review again',
    snapshot,
  })}`);
  assert.equal(error.code, 'STALE_PREVIEW');
  assert.deepEqual(error.snapshot, snapshot);
  assert.equal(error.message, 'Review again');
});

test('controller clears approval token and restores review on stale preview', async () => {
  const calls = [];
  const rendered = [];
  const controller = createAgentWorkspaceController({
    bridgeRequest: async (message) => {
      calls.push(message);
      if (message.type === 'OPENBROWSER_APPLY_RUN') {
        const error = new Error('The project changed after this preview.');
        error.code = 'STALE_PREVIEW';
        error.snapshot = {
          id: 'run-1',
          status: 'awaiting_approval',
          previewRevision: 'next',
          operations: [],
        };
        throw error;
      }
      return { approvalToken: 'secret-token', expiresAt: Date.now() + 1000 };
    },
    storage: {
      get: async () => ({}),
      set: async () => undefined,
      remove: async () => undefined,
    },
    render: (state) => rendered.push(state),
  });

  controller.acceptSnapshot({
    id: 'run-1',
    status: 'awaiting_approval',
    previewRevision: 'first',
    operations: [{ id: 'op-1', risk: 'WRITE', requiresExplicitApproval: false }],
  });
  await controller.approve(['op-1']);
  await assert.rejects(() => controller.apply(), /changed after this preview/i);
  assert.equal(controller.getState().approvalToken, undefined);
  assert.equal(controller.getState().showReview, true);
  assert.match(controller.getState().notice, /Review the updated diff/i);
  assert.equal(calls.at(-1).approvalToken, 'secret-token');
  assert.equal(rendered.length > 0, true);
});
