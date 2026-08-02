import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAlreadyRoutedChatPrompt,
  normalizeChatRoutingSettings,
  prepareChatPrompt,
  shouldInterceptChatKeydown,
} from './chat-prompt-routing.js';
import { composeRoutedChatPrompt } from './chat-prompt-envelope.js';

const prompt = {
  id: 'TB-PROMPT-TEST-001',
  title: 'Test Architecture Audit',
  version: '1.0.0',
  sourceType: 'canonical',
  path: 'prompt-library/test.md',
  workModes: ['ask', 'agent'],
  routingIntents: ['audit test architecture'],
  negativeRoutingIntents: [],
  tags: ['audit', 'architecture'],
  category: 'Testing',
  purpose: 'Audit test architecture.',
  description: 'Audit a test architecture.',
};

const body = '# Test Architecture Audit\n\n| ID | `TB-PROMPT-TEST-001` |';

test('normalizes chat routing settings without accepting unknown modes', () => {
  assert.deepEqual(normalizeChatRoutingSettings({ mode: 'manual', manualPromptId: ' x ' }), {
    mode: 'manual',
    manualPromptId: 'x',
  });
  assert.deepEqual(normalizeChatRoutingSettings({ mode: 'unexpected' }), {
    mode: 'auto',
    manualPromptId: '',
  });
});

test('prepareChatPrompt selects and composes a prompt for normal chat', async () => {
  const result = await prepareChatPrompt({
    request: 'Please audit test architecture',
    catalog: [prompt],
    settings: { mode: 'auto' },
    bodyLoader: async () => body,
  });

  assert.equal(result.enhanced, true);
  assert.equal(result.route.status, 'selected');
  assert.equal(result.route.selected.id, prompt.id);
  assert.match(result.outbound, /# Titan Builder Routed Chat Task/);
  assert.match(result.outbound, /Please audit test architecture/);
  assert.match(result.outbound, /# Test Architecture Audit/);
  assert.doesNotMatch(result.outbound, /current registered project/i);
});

test('off, none, and ambiguous routes preserve the original chat message', async () => {
  for (const input of [
    { settings: { mode: 'off' }, request: 'Explain blue' },
    { settings: { mode: 'auto' }, request: 'Explain blue' },
  ]) {
    const result = await prepareChatPrompt({ ...input, catalog: [prompt], bodyLoader: async () => body });
    assert.equal(result.enhanced, false);
    assert.equal(result.outbound, input.request);
  }

  const second = { ...prompt, id: 'TB-PROMPT-TEST-002', title: 'Test Platform Audit' };
  const ambiguous = await prepareChatPrompt({
    request: 'Audit test platform architecture',
    catalog: [prompt, second],
    settings: { mode: 'auto' },
    routingOptions: { minMargin: 100 },
    bodyLoader: async () => body,
  });
  assert.equal(ambiguous.route.status, 'ambiguous');
  assert.equal(ambiguous.enhanced, false);
  assert.equal(ambiguous.outbound, 'Audit test platform architecture');
});

test('canonical body-load failures fail open to the original chat message visibly', async () => {
  const result = await prepareChatPrompt({
    request: 'Please audit test architecture',
    catalog: [prompt],
    settings: { mode: 'auto' },
    bodyLoader: async () => { throw new Error('missing body'); },
  });

  assert.equal(result.enhanced, false);
  assert.equal(result.outbound, 'Please audit test architecture');
  assert.equal(result.route.status, 'load-error');
  assert.match(result.error, /missing body/);
});

test('invalid manual selection fails open to the original message', async () => {
  const result = await prepareChatPrompt({
    request: 'Audit this project',
    catalog: [prompt],
    settings: { mode: 'manual', manualPromptId: 'missing' },
    bodyLoader: async () => body,
  });
  assert.equal(result.enhanced, false);
  assert.equal(result.outbound, 'Audit this project');
  assert.equal(result.route.status, 'routing-error');
  assert.match(result.error, /Manual prompt selection is invalid/);
});

test('already-routed messages are never wrapped twice', async () => {
  const request = '# Titan Builder Routed Chat Task\n\nExisting envelope';
  assert.equal(isAlreadyRoutedChatPrompt(request), true);
  const result = await prepareChatPrompt({ request, catalog: [prompt] });
  assert.equal(result.route.status, 'already-routed');
  assert.equal(result.outbound, request);
});

test('chat envelope preserves the request and limits authority to the current chat', () => {
  const output = composeRoutedChatPrompt({
    request: 'Audit this uploaded extension.',
    prompt,
    body,
    route: { reason: 'auto', score: 55, margin: 12 },
  });
  assert.match(output, /Audit this uploaded extension\./);
  assert.match(output, /Use only the conversation, uploaded files, connected tools, and provider capabilities actually available/);
  assert.match(output, /does not grant filesystem, repository-write, shell, deployment, approval, or business-operation authority/);
  assert.doesNotMatch(output, /registered project/i);
});

test('keydown interception accepts plain Enter only inside the composer', () => {
  const composer = { contains: (node) => node === 'inside' };
  assert.equal(shouldInterceptChatKeydown({ key: 'Enter', target: 'inside' }, composer), true);
  assert.equal(shouldInterceptChatKeydown({ key: 'Enter', shiftKey: true, target: 'inside' }, composer), false);
  assert.equal(shouldInterceptChatKeydown({ key: 'Enter', isComposing: true, target: 'inside' }, composer), false);
  assert.equal(shouldInterceptChatKeydown({ key: 'Enter', target: 'outside' }, composer), false);
});
