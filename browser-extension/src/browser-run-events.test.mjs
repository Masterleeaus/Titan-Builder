import assert from 'node:assert/strict';
import test from 'node:test';
import { withBridgeAuth } from './bridge-config.js';
import { createRunEventMonitor, parseSseFrames } from './browser-run-events.js';

test('workflow requests use only the browser token', () => {
  const headers = withBridgeAuth({ bridgeToken: 'browser-token'.padEnd(40, 'x') }, {});
  assert.match(headers.Authorization, /^Bearer browser-token/);
  assert.equal(JSON.stringify(headers).includes('BRIDGE_TOKEN'), false);
});

test('SSE parser returns complete named events and preserves partial input', () => {
  const parsed = parseSseFrames('event: snapshot\ndata: {"id":"run-1"}\n\nevent: upd');
  assert.deepEqual(parsed.events, [{ event: 'snapshot', data: { id: 'run-1' } }]);
  assert.equal(parsed.remainder, 'event: upd');
});

test('monitor refreshes latest snapshot and ignores stale run events', async () => {
  const snapshots = [];
  const requests = [];
  const monitor = createRunEventMonitor({
    request: async (path) => {
      requests.push(path);
      return { id: path.includes('run-2') ? 'run-2' : 'run-1', status: 'completed' };
    },
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    setTimer: () => 1,
    clearTimer: () => undefined,
  });
  await monitor.start('run-1');
  await monitor.start('run-2');
  monitor.accept({ id: 'run-1', status: 'failed' });
  monitor.accept({ id: 'run-2', status: 'completed' });
  assert.deepEqual(snapshots.map((item) => item.id), ['run-1', 'run-2', 'run-2']);
  assert.deepEqual(requests, ['/workspace/runs/run-1', '/workspace/runs/run-2']);
});
