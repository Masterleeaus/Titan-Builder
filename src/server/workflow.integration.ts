import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeServer } from './index.ts';
import { clearSessions } from './session-store.ts';

test.beforeEach(() => {
  clearSessions();
  delete process.env.BRIDGE_TOKEN;
});

test('bridge workflow recovers, claims, streams, and completes with a lease token', async () => {
  const app = await createBridgeServer();
  await app.ready();

  const created = await app.inject({
    method: 'POST',
    url: '/session/prompt',
    payload: {
      mode: 'ask',
      prompt: 'hello',
      systemPrompt: 'system',
      message: 'message',
      conversationId: 'conversation-1',
    },
  });
  assert.equal(created.statusCode, 200);
  const { sessionId } = created.json() as { sessionId: string };

  const pending = await app.inject({ method: 'GET', url: '/browser/pending' });
  assert.equal(pending.statusCode, 200);
  assert.equal(pending.json().jobs[0].sessionId, sessionId);

  const claim = await app.inject({
    method: 'POST',
    url: '/browser/claim',
    payload: { sessionId, claimantId: 'test-tab' },
  });
  assert.equal(claim.statusCode, 200);
  const claimPayload = claim.json() as { claimed: boolean; claimToken: string };
  assert.equal(claimPayload.claimed, true);
  assert.ok(claimPayload.claimToken);

  const duplicate = await app.inject({
    method: 'POST',
    url: '/browser/claim',
    payload: { sessionId, claimantId: 'other-tab' },
  });
  assert.equal(duplicate.json().claimed, false);

  const heartbeat = await app.inject({
    method: 'POST',
    url: '/browser/heartbeat',
    payload: { sessionId, claimToken: claimPayload.claimToken },
  });
  assert.equal(heartbeat.statusCode, 200);
  assert.equal(heartbeat.json().accepted, true);

  const chunk = await app.inject({
    method: 'POST',
    url: '/browser/chunk',
    payload: { sessionId, claimToken: claimPayload.claimToken, text: 'partial' },
  });
  assert.equal(chunk.statusCode, 200);

  const complete = await app.inject({
    method: 'POST',
    url: '/browser/response',
    payload: { sessionId, claimToken: claimPayload.claimToken, text: 'complete answer' },
  });
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.json().status, 'complete');

  const status = await app.inject({ method: 'GET', url: `/session/${sessionId}/status` });
  assert.deepEqual(status.json(), {
    sessionId,
    status: 'complete',
    mode: 'ask',
    response: 'complete answer',
  });

  const empty = await app.inject({ method: 'GET', url: '/browser/pending' });
  assert.deepEqual(empty.json(), { jobs: [] });

  await app.close();
});
