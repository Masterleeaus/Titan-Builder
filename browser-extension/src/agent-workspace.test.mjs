import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCreateRunPayload,
  buildOperationSelection,
  createAgentWorkspaceController,
  parseBridgeError,
  prepareRoutedWorkPrompt,
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

test('prepareRoutedWorkPrompt composes a high-confidence automatic route', async () => {
  const catalog = [{
    id: 'TB-PROMPT-TZ-ARCH-001',
    title: 'Titan Zero and WorkCore Authority Boundary Audit',
    purpose: 'Audit authority boundaries and duplicated operational truth.',
    tags: ['titan-zero', 'workcore', 'authority-boundary'],
    routingIntents: ['audit titan zero workcore authority'],
    workModes: ['agent'],
    sourceType: 'canonical',
    path: 'prompt-library/titan-zero/tz-arch-001.md',
  }];
  const prepared = await prepareRoutedWorkPrompt({
    prompt: 'Audit Titan Zero and WorkCore authority boundaries.',
    mode: 'agent',
    promptRoutingMode: 'auto',
  }, {
    catalog,
    loadPromptBody: async () => '# Canonical audit prompt',
  });
  assert.equal(prepared.route.status, 'selected');
  assert.equal(prepared.selectedPrompt.id, 'TB-PROMPT-TZ-ARCH-001');
  assert.equal(prepared.originalPrompt, 'Audit Titan Zero and WorkCore authority boundaries.');
  assert.match(prepared.prompt, /# Canonical audit prompt/);
  assert.match(prepared.prompt, /Audit Titan Zero and WorkCore authority boundaries\./);
});

test('prepareRoutedWorkPrompt preserves the raw task for ambiguous, none, and off routes', async () => {
  const catalog = [
    { id: 'one', title: 'Runtime Architecture Audit', purpose: 'Audit runtime architecture.', routingIntents: ['audit runtime architecture'], workModes: ['agent'], content: 'one', sourceType: 'builtin' },
    { id: 'two', title: 'Platform Architecture Audit', purpose: 'Audit platform architecture.', routingIntents: ['audit platform architecture'], workModes: ['agent'], content: 'two', sourceType: 'builtin' },
  ];
  const ambiguous = await prepareRoutedWorkPrompt({
    prompt: 'Audit runtime platform architecture',
    mode: 'agent',
    promptRoutingMode: 'auto',
  }, { catalog });
  assert.equal(ambiguous.route.status, 'ambiguous');
  assert.equal(ambiguous.prompt, 'Audit runtime platform architecture');

  const none = await prepareRoutedWorkPrompt({
    prompt: 'Explain the colour blue',
    mode: 'agent',
    promptRoutingMode: 'auto',
  }, { catalog });
  assert.equal(none.route.status, 'none');
  assert.equal(none.prompt, 'Explain the colour blue');

  const off = await prepareRoutedWorkPrompt({
    prompt: 'Audit runtime architecture',
    mode: 'agent',
    promptRoutingMode: 'off',
  }, { catalog });
  assert.equal(off.route.status, 'off');
  assert.equal(off.prompt, 'Audit runtime architecture');
});

test('prepareRoutedWorkPrompt honours a manual prompt and rejects an invalid manual ID', async () => {
  const catalog = [{
    id: 'systematic-debug',
    title: 'Systematic Bug Debugger',
    workModes: ['ask', 'agent'],
    content: 'Debug systematically.',
    sourceType: 'builtin',
  }];
  const prepared = await prepareRoutedWorkPrompt({
    prompt: 'Fix the failing test.',
    mode: 'agent',
    promptRoutingMode: 'manual',
    manualPromptId: 'systematic-debug',
  }, { catalog });
  assert.equal(prepared.route.reason, 'manual');
  assert.match(prepared.prompt, /Debug systematically\./);
  await assert.rejects(
    () => prepareRoutedWorkPrompt({
      prompt: 'Fix the failing test.',
      mode: 'agent',
      promptRoutingMode: 'manual',
      manualPromptId: 'missing',
    }, { catalog }),
    /manual prompt/i,
  );
});

test('controller sends the prepared routed prompt without changing approval behaviour', async () => {
  const calls = [];
  const controller = createAgentWorkspaceController({
    bridgeRequest: async (message) => {
      calls.push(message);
      return { id: 'run-routed', status: 'preparing', operations: [] };
    },
    storage: { set: async () => undefined, remove: async () => undefined },
    render: () => undefined,
    preparePrompt: async (input) => ({
      prompt: `ROUTED\n${input.prompt}`,
      originalPrompt: input.prompt,
      route: { status: 'selected', selected: { id: 'systematic-debug' }, score: 60, margin: 20 },
      selectedPrompt: { id: 'systematic-debug', title: 'Systematic Bug Debugger' },
    }),
  });
  await controller.start({
    mode: 'agent',
    prompt: 'Fix it',
    projectId: 'project-1234567890abcdef',
    contextRefs: 'src',
    promptRoutingMode: 'auto',
  });
  assert.equal(calls[0].payload.prompt, 'ROUTED\nFix it');
  assert.equal(controller.getState().promptRoute.selected.id, 'systematic-debug');
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
