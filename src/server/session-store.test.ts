import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSessions,
  completeSession,
  createSession,
  failSession,
  getSession,
  listDispatchableSessions,
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
  assert.equal(completed?.claimToken, undefined);

  assert.throws(
    () => failSession(session.id, 'late failure', claim.claimToken, 12_400),
    /not claimed/i,
  );
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
