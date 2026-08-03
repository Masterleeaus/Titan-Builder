import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSessions,
  completeSession,
  createSession,
  DEFAULT_SESSION_RETENTION_MS,
  failSession,
  getSession,
  listDispatchableSessions,
  pruneSessions,
  renewSessionClaim,
  releaseClaim,
  tryClaimSession,
  updateSessionPartial,
} from './session-store.ts';

function createFixture() {
  return createSession({
    mode: 'ask',
    prompt: 'hello',
    systemPrompt: 'system',
    message: 'message',
    composerMessage: 'message',
    delivery: 'text',
    conversationId: 'conversation-1',
  });
}

test.beforeEach(() => clearSessions());

test('claim leases are exclusive and expired claims become dispatchable again', () => {
  const session = createFixture();
  const first = tryClaimSession(session.id, {
    claimantId: 'tab-1',
    nowMs: 1_000,
    leaseMs: 5_000,
  });

  assert.ok(first);
  assert.equal(first.session.status, 'claimed');
  assert.equal(first.session.claimantId, 'tab-1');
  assert.equal(first.session.attemptCount, 1);
  assert.ok(first.claimToken.length > 20);

  const duplicate = tryClaimSession(session.id, {
    claimantId: 'tab-2',
    nowMs: 2_000,
    leaseMs: 5_000,
  });
  assert.equal(duplicate, null);
  assert.equal(listDispatchableSessions(5_999).length, 0);

  const recovered = listDispatchableSessions(6_001);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.status, 'pending');

  const second = tryClaimSession(session.id, {
    claimantId: 'tab-2',
    nowMs: 6_100,
    leaseMs: 5_000,
  });
  assert.ok(second);
  assert.notEqual(second.claimToken, first.claimToken);
  assert.equal(second.session.attemptCount, 2);
});

test('chunks, completion, renewal, and release require the current claim token', () => {
  const session = createFixture();
  const claim = tryClaimSession(session.id, {
    claimantId: 'tab-1',
    nowMs: 10_000,
    leaseMs: 5_000,
  });
  assert.ok(claim);

  assert.throws(
    () => updateSessionPartial(session.id, 'partial', 'wrong-token', 10_100),
    /claim token/i,
  );

  const renewed = renewSessionClaim(session.id, claim.claimToken, {
    nowMs: 12_000,
    leaseMs: 7_000,
  });
  assert.equal(renewed?.claimExpiresAt, new Date(19_000).toISOString());

  const partial = updateSessionPartial(session.id, 'partial', claim.claimToken, 12_100);
  assert.equal(partial?.partialText, 'partial');
  assert.equal(partial?.lastActivityAt, new Date(12_100).toISOString());

  assert.throws(
    () => completeSession(session.id, 'done', 'wrong-token', 12_200),
    /claim token/i,
  );

  const completed = completeSession(session.id, 'done', claim.claimToken, 12_300);
  assert.equal(completed?.status, 'complete');
  assert.equal(completed?.response, 'done');
  assert.equal(completed?.partialText, undefined);
  assert.equal(completed?.claimToken, undefined);

  assert.throws(
    () => failSession(session.id, 'late failure', claim.claimToken, 12_400),
    /not claimed/i,
  );
});

test('terminal failures discard transient partial response text', () => {
  const session = createFixture();
  const claim = tryClaimSession(session.id, {
    claimantId: 'tab-1',
    nowMs: 20_000,
    leaseMs: 5_000,
  });
  assert.ok(claim);

  updateSessionPartial(session.id, 'incomplete stream', claim.claimToken, 20_100);
  const failed = failSession(session.id, 'provider failed', claim.claimToken, 20_200);

  assert.equal(failed?.status, 'error');
  assert.equal(failed?.error, 'provider failed');
  assert.equal(failed?.partialText, undefined);
});

test('a claimed session can be explicitly released and reclaimed', () => {
  const session = createFixture();
  const claim = tryClaimSession(session.id, {
    claimantId: 'tab-1',
    nowMs: 1_000,
    leaseMs: 30_000,
  });
  assert.ok(claim);

  assert.throws(() => releaseClaim(session.id, 'wrong-token', 1_100), /claim token/i);
  const released = releaseClaim(session.id, claim.claimToken, 1_200);
  assert.equal(released?.status, 'pending');
  assert.equal(released?.claimToken, undefined);

  const reclaimed = tryClaimSession(session.id, {
    claimantId: 'tab-2',
    nowMs: 1_300,
    leaseMs: 30_000,
  });
  assert.ok(reclaimed);
  assert.equal(reclaimed.session.attemptCount, 2);
  assert.equal(getSession(session.id)?.claimantId, 'tab-2');
});

test('pruning removes old completed and failed sessions but keeps pending and claimed', () => {
  const now = 1_000_000;

  const pending = createSession({
    mode: 'ask',
    prompt: 'pending',
    systemPrompt: 'system',
    message: 'message',
    composerMessage: 'message',
    delivery: 'text',
    conversationId: 'pending-1',
  });

  const claimed = createSession({
    mode: 'ask',
    prompt: 'claimed',
    systemPrompt: 'system',
    message: 'message',
    composerMessage: 'message',
    delivery: 'text',
    conversationId: 'claimed-1',
  });
  tryClaimSession(claimed.id, { nowMs: now, leaseMs: 5_000 });

  const oldCompleted = createSession({
    mode: 'ask',
    prompt: 'old complete',
    systemPrompt: 'system',
    message: 'message',
    composerMessage: 'message',
    delivery: 'text',
    conversationId: 'old-complete-1',
  });
  const completeClaim = tryClaimSession(oldCompleted.id, { nowMs: now - DEFAULT_SESSION_RETENTION_MS - 100_000, leaseMs: 5_000 });
  assert.ok(completeClaim);
  completeSession(oldCompleted.id, 'response', completeClaim.claimToken, now - DEFAULT_SESSION_RETENTION_MS - 100_000 + 5_000);

  const oldFailed = createSession({
    mode: 'ask',
    prompt: 'old failed',
    systemPrompt: 'system',
    message: 'message',
    composerMessage: 'message',
    delivery: 'text',
    conversationId: 'old-failed-1',
  });
  const failClaim = tryClaimSession(oldFailed.id, { nowMs: now - DEFAULT_SESSION_RETENTION_MS - 100_000, leaseMs: 5_000 });
  assert.ok(failClaim);
  failSession(oldFailed.id, 'error', failClaim.claimToken, now - DEFAULT_SESSION_RETENTION_MS - 100_000 + 5_000);

  const recentCompleted = createSession({
    mode: 'ask',
    prompt: 'recent complete',
    systemPrompt: 'system',
    message: 'message',
    composerMessage: 'message',
    delivery: 'text',
    conversationId: 'recent-complete-1',
  });
  const recentClaim = tryClaimSession(recentCompleted.id, { nowMs: now - 1_000, leaseMs: 5_000 });
  assert.ok(recentClaim);
  completeSession(recentCompleted.id, 'response', recentClaim.claimToken, now - 1_000 + 100);

  const result = pruneSessions(now);
  assert.equal(result.removed, 2, 'should remove old completed and failed sessions');
  assert.ok(getSession(pending.id), 'pending session should be retained');
  assert.ok(getSession(claimed.id), 'claimed session should be retained');
  assert.equal(getSession(oldCompleted.id), undefined, 'old completed session should be removed');
  assert.equal(getSession(oldFailed.id), undefined, 'old failed session should be removed');
  assert.ok(getSession(recentCompleted.id), 'recent completed session should be retained');
});
