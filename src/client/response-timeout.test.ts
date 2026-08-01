import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveResponseTimeouts } from './response-timeout.ts';

test('uses long but bounded defaults for browser AI work', () => {
  assert.deepEqual(resolveResponseTimeouts({}), {
    idleTimeoutMs: 180_000,
    totalTimeoutMs: 900_000,
  });
});

test('accepts environment overrides within safe bounds', () => {
  assert.deepEqual(
    resolveResponseTimeouts({
      OPENBROWSER_RESPONSE_IDLE_TIMEOUT_MS: '60000',
      OPENBROWSER_RESPONSE_TIMEOUT_MS: '1200000',
    }),
    { idleTimeoutMs: 60_000, totalTimeoutMs: 1_200_000 },
  );
});

test('clamps invalid and extreme timeout values', () => {
  assert.deepEqual(
    resolveResponseTimeouts({
      OPENBROWSER_RESPONSE_IDLE_TIMEOUT_MS: '1',
      OPENBROWSER_RESPONSE_TIMEOUT_MS: '999999999',
    }),
    { idleTimeoutMs: 30_000, totalTimeoutMs: 3_600_000 },
  );
});
