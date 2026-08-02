import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const backgroundUrl = new URL('./background.js', import.meta.url);
const contentUrl = new URL('./content-script.js', import.meta.url);

test('background recovers pending jobs after reconnect and keepalive', async () => {
  const source = await readFile(backgroundUrl, 'utf8');
  assert.match(source, /bridgeRequest\('\/browser\/pending'/);
  assert.match(source, /recoverPendingJobs\(\{ force: true \}\)/);
  assert.match(source, /dispatchedSessionIds\.delete\(job\.sessionId\)/);
});

test('content script acknowledges dispatch immediately and authenticates lifecycle updates', async () => {
  const source = await readFile(contentUrl, 'utf8');
  assert.match(source, /sendResponse\?\.\(\{ ok: true, accepted: true \}\)/);
  assert.match(source, /claimToken/);
  assert.match(source, /\/browser\/heartbeat/);
  assert.match(source, /claimToken: job\.claimToken/);
  assert.doesNotMatch(source, /await handleIncomingJob\(message\.job\)[\s\S]*?sendResponse/);
});
