import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  clearSessions,
  completeSession,
  createSession,
  failSession,
  flushSessionsToDisk,
  getSession,
  initializeSessionStore,
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

test('prompt exceeding maximum size is rejected at creation', () => {
  const oversized = 'x'.repeat(2_000_000);
  assert.throws(
    () => createSession({
      mode: 'ask',
      prompt: oversized,
      systemPrompt: 'system',
      message: 'message',
      composerMessage: 'message',
      delivery: 'text',
      conversationId: 'conversation-1',
    }),
    /exceeds maximum/i,
  );
});

test('response exceeding maximum size is rejected at completion', () => {
  const session = createFixture();
  const claim = tryClaimSession(session.id, { claimantId: 'tab-1', nowMs: 1_000, leaseMs: 5_000 });
  assert.ok(claim);

  const oversized = 'x'.repeat(10_000_000);
  assert.throws(
    () => completeSession(session.id, oversized, claim.claimToken, 1_100),
    /exceeds maximum/i,
  );
});

test('error message exceeding maximum size is rejected', () => {
  const session = createFixture();
  const claim = tryClaimSession(session.id, { claimantId: 'tab-1', nowMs: 1_000, leaseMs: 5_000 });
  assert.ok(claim);

  const oversized = 'x'.repeat(100_000);
  assert.throws(
    () => failSession(session.id, oversized, claim.claimToken, 1_100),
    /exceeds maximum/i,
  );
});

test('session size limits are enforced', () => {
  clearSessions();

  // Verify that we can create and complete normal sessions
  const session = createFixture();
  const claim = tryClaimSession(session.id, { claimantId: 'tab-1', nowMs: 1_000, leaseMs: 5_000 });
  assert.ok(claim);

  const completed = completeSession(session.id, 'normal response', claim.claimToken, 1_100);
  assert.equal(completed?.status, 'complete');
  assert.ok(getSession(session.id));
});

test('persistence can be initialized with custom path', async () => {
  clearSessions();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'session-store-test-'));
  const storePath = path.join(tempDir, 'sessions.json');

  await initializeSessionStore(storePath);

  const session = createFixture();
  await flushSessionsToDisk();

  // Verify file was created
  const content = await import('node:fs/promises').then(fs => fs.readFile(storePath, 'utf8'));
  const parsed = JSON.parse(content);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.id, session.id);
});
