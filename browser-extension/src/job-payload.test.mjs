import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeOutboundMessage,
  mergeWorkspaceInstructions,
  prepareOutboundJob,
  selectOutboundMessage,
} from './job-payload.js';

const BASE_SYSTEM = 'Base coding instructions.';
const BASE_MESSAGE = [
  '--- OpenBrowser System Instructions ---',
  BASE_SYSTEM,
  '--- End System Instructions ---',
  '',
  '--- User Request ---',
  'Fix the bug.',
].join('\n');

const PROFILE = [
  '--- OpenBrowser Active Agent Profile ---',
  'Name: Security Auditor',
  'Audit security boundaries.',
  '--- End Agent Profile ---',
].join('\n');

const SKILL = [
  '--- OpenBrowser Active Skills ---',
  '### TDD',
  'Write a failing test first.',
  '--- End Active Skills ---',
].join('\n');

test('profile-only, skill-only, and combined workspace instructions appear exactly once', () => {
  for (const workspace of [PROFILE, SKILL, `${PROFILE}\n\n${SKILL}`]) {
    const merged = mergeWorkspaceInstructions(BASE_SYSTEM, workspace);
    const message = composeOutboundMessage(BASE_MESSAGE, merged);

    assert.equal(message.match(/--- OpenBrowser System Instructions ---/g)?.length, 1);
    assert.equal(message.match(/--- End System Instructions ---/g)?.length, 1);
    assert.match(message, /Base coding instructions\./);
    assert.match(message, /--- User Request ---\nFix the bug\./);

    if (workspace.includes('Agent Profile')) {
      assert.equal(message.match(/--- OpenBrowser Active Agent Profile ---/g)?.length, 1);
    }
    if (workspace.includes('Active Skills')) {
      assert.equal(message.match(/--- OpenBrowser Active Skills ---/g)?.length, 1);
    }
  }
});

test('current workspace replaces stale profile and skill sections instead of duplicating them', () => {
  const stale = `${BASE_SYSTEM}\n\n${PROFILE}\n\n${SKILL}`;
  const current = [
    '--- OpenBrowser Active Agent Profile ---',
    'Name: Runtime Engineer',
    'Repair runtime defects.',
    '--- End Agent Profile ---',
  ].join('\n');

  const merged = mergeWorkspaceInstructions(stale, current);
  assert.doesNotMatch(merged, /Security Auditor/);
  assert.doesNotMatch(merged, /### TDD/);
  assert.match(merged, /Runtime Engineer/);
  assert.equal(merged.match(/--- OpenBrowser Active Agent Profile ---/g)?.length, 1);
});

test('new and established threads receive the same authoritative text payload', () => {
  const prepared = prepareOutboundJob({
    sessionId: 'session-1',
    systemPrompt: BASE_SYSTEM,
    promptBody: BASE_MESSAGE,
    promptInjectionCharLimit: 40_000,
    promptFileComposerNote: 'Read the attached prompt.',
  }, `${PROFILE}\n\n${SKILL}`);

  assert.equal(prepared.delivery, 'text');
  assert.equal(selectOutboundMessage(prepared, { threadIsEmpty: true }), prepared.outboundMessage);
  assert.equal(selectOutboundMessage(prepared, { threadIsEmpty: false }), prepared.outboundMessage);
  assert.match(prepared.outboundMessage, /Security Auditor/);
  assert.match(prepared.outboundMessage, /### TDD/);
});

test('file delivery uses the same final payload and is recalculated after workspace enrichment', () => {
  const workspace = `${PROFILE}\n\n${SKILL}`;
  const prepared = prepareOutboundJob({
    sessionId: 'session-2',
    systemPrompt: BASE_SYSTEM,
    promptBody: BASE_MESSAGE,
    promptInjectionCharLimit: BASE_MESSAGE.length + 10,
    promptFileComposerNote: 'Read the attached prompt.',
    promptFileName: 'openbrowser-prompt.txt',
  }, workspace);

  assert.equal(prepared.delivery, 'file');
  assert.equal(prepared.message, 'Read the attached prompt.');
  assert.equal(prepared.composerMessage, 'Read the attached prompt.');
  assert.equal(prepared.promptFileContent, prepared.outboundMessage);
  assert.match(prepared.promptFileContent, /Security Auditor/);
  assert.match(prepared.promptFileContent, /### TDD/);
  assert.equal(selectOutboundMessage(prepared, { threadIsEmpty: false }), prepared.outboundMessage);
});

test('file jobs recover the full prompt body rather than composing from the attachment note', () => {
  const prepared = prepareOutboundJob({
    sessionId: 'session-3',
    systemPrompt: BASE_SYSTEM,
    message: 'The full prompt is attached.',
    promptBody: BASE_MESSAGE,
    promptInjectionCharLimit: 1,
    promptFileComposerNote: 'The full prompt is attached.',
  }, PROFILE);

  assert.match(prepared.outboundMessage, /Fix the bug\./);
  assert.doesNotMatch(prepared.outboundMessage, /The full prompt is attached\.[\s\S]*The full prompt is attached\./);
  assert.equal(prepared.promptFileContent, prepared.outboundMessage);
});
