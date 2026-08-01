import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAutoContinueSettings,
  shouldAutoContinue,
  getContinuationAction,
} from './auto-continue-policy.js';

test('auto-continue defaults off and caps max continuations at ten', () => {
  assert.deepEqual(normalizeAutoContinueSettings({}), {
    enabled: false,
    maxContinuations: 3,
    allowFallbackPrompt: false,
    fallbackPrompt: 'Continue from where you stopped. Do not repeat completed content.',
  });
  assert.equal(normalizeAutoContinueSettings({ enabled: true, maxContinuations: 50 }).maxContinuations, 10);
  assert.equal(normalizeAutoContinueSettings({ maxContinuations: 0 }).maxContinuations, 1);
});

test('continues only for enabled OpenBrowser ask or panel jobs below the cap', () => {
  const settings = normalizeAutoContinueSettings({ enabled: true, maxContinuations: 2 });
  assert.equal(shouldAutoContinue({ settings, count: 0, scope: 'panel', mode: 'ask' }), true);
  assert.equal(shouldAutoContinue({ settings, count: 2, scope: 'panel', mode: 'ask' }), false);
  assert.equal(shouldAutoContinue({ settings, count: 0, scope: 'job', mode: 'agent' }), false);
  assert.equal(shouldAutoContinue({ settings, count: 0, scope: 'unknown', mode: 'ask' }), false);
});

test('prefers native continue control and uses fallback only when explicitly allowed', () => {
  const strict = normalizeAutoContinueSettings({ enabled: true });
  const fallback = normalizeAutoContinueSettings({ enabled: true, allowFallbackPrompt: true });
  assert.deepEqual(getContinuationAction({ settings: strict, nativeAvailable: true }), { type: 'native' });
  assert.deepEqual(getContinuationAction({ settings: strict, nativeAvailable: false }), { type: 'stop' });
  assert.deepEqual(getContinuationAction({ settings: fallback, nativeAvailable: false }), {
    type: 'fallback',
    prompt: fallback.fallbackPrompt,
  });
});
