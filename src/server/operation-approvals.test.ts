import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOperationApprovalStore,
} from './operation-approvals.ts';
import type { PlannedOperation } from '../operations/index.ts';
import type { RepositoryIdentity } from '../security/repository-identity.ts';

function fixturePlan(): PlannedOperation[] {
  return [{
    operation: { action: 'CREATE_FILE', path: 'safe.txt', content: 'hello\n' },
    absolutePath: '/project/safe.txt',
    diff: 'diff -- safe.txt',
    risk: 'WRITE',
    preconditions: [{
      absolutePath: '/project/safe.txt',
      kind: 'missing',
      hash: 'missing-hash',
    }],
    affectedPaths: ['/project/safe.txt'],
  }];
}

function fixtureRepositoryIdentity(
  overrides: Partial<Extract<RepositoryIdentity, { kind: 'git' }>> = {},
): Extract<RepositoryIdentity, { kind: 'git' }> {
  return {
    kind: 'git',
    projectRoot: '/project',
    projectRootIdentity: { device: '1', inode: '10' },
    repositoryRoot: '/project',
    worktreeIdentity: { device: '1', inode: '10' },
    commonDir: '/project/.git',
    commonDirIdentity: { device: '1', inode: '20' },
    gitDir: '/project/.git',
    gitDirIdentity: { device: '1', inode: '20' },
    branch: 'feature/review',
    head: 'a'.repeat(40),
    indexPath: '/project/.git/index',
    indexDigest: 'b'.repeat(64),
    indexIdentity: {
      device: '1',
      inode: '30',
      size: '128',
      modifiedNanoseconds: '1000',
      changedNanoseconds: '1000',
    },
    ...overrides,
  };
}

test('approval token is one-time, short lived, and bound to exact project and preview', () => {
  let now = 1_000;
  const store = createOperationApprovalStore({
    ttlMs: 5_000,
    now: () => now,
  });
  const plans = fixturePlan();
  const repositoryIdentity = fixtureRepositoryIdentity();
  const expectation = { projectRoot: '/project', repositoryIdentity };
  const approval = store.issue({ projectRoot: '/project', repositoryIdentity, plans });

  assert.match(approval.token, /^oba_/);
  assert.equal(approval.expiresAt, 6_000);
  assert.match(approval.previewHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(approval.riskSummary, { WRITE: 1 });

  plans[0]!.operation.path = 'tampered.txt';
  const consumed = store.consume(approval.token, expectation);
  assert.equal(consumed[0]?.operation.path, 'safe.txt');
  assert.throws(() => store.consume(approval.token, expectation), /already used|invalid/i);

  const wrongRoot = store.issue({
    projectRoot: '/project',
    repositoryIdentity,
    plans: fixturePlan(),
  });
  assert.throws(
    () => store.consume(wrongRoot.token, { projectRoot: '/other', repositoryIdentity }),
    /project root/i,
  );

  const expired = store.issue({
    projectRoot: '/project',
    repositoryIdentity,
    plans: fixturePlan(),
  });
  now = expired.expiresAt + 1;
  assert.throws(() => store.consume(expired.token, expectation), /expired/i);
});

test('browser approval is bound to run, conversation, revision, and selected operations', () => {
  const expected = {
    projectRoot: '/project',
    repositoryIdentity: fixtureRepositoryIdentity(),
    runId: 'run-browser-12345678',
    conversationId: 'conversation-123',
    previewRevision: 'a'.repeat(64),
    selectedOperationIds: ['op-1'],
  };

  for (const mismatch of [
    { ...expected, runId: 'run-browser-87654321' },
    { ...expected, conversationId: 'conversation-other' },
    { ...expected, previewRevision: 'b'.repeat(64) },
    { ...expected, selectedOperationIds: ['op-2'] },
  ]) {
    const store = createOperationApprovalStore();
    const approval = store.issue({ ...expected, plans: fixturePlan() });
    assert.throws(() => store.consume(approval.token, mismatch), /bound to|different/i);
  }

  const store = createOperationApprovalStore();
  const approval = store.issue({ ...expected, plans: fixturePlan() });
  assert.equal(store.inspect(approval.token, expected).runId, expected.runId);
  assert.equal(store.consume(approval.token, expected).length, 1);
  assert.throws(() => store.consume(approval.token, expected), /already used|invalid/i);
});

test('approval capability rejects branch, HEAD, index, and worktree identity changes', () => {
  const reviewedIdentity = fixtureRepositoryIdentity();
  const mismatches: RepositoryIdentity[] = [
    fixtureRepositoryIdentity({ branch: 'main' }),
    fixtureRepositoryIdentity({ head: 'c'.repeat(40) }),
    fixtureRepositoryIdentity({ indexDigest: 'd'.repeat(64) }),
    fixtureRepositoryIdentity({ worktreeIdentity: { device: '1', inode: '99' } }),
  ];

  for (const repositoryIdentity of mismatches) {
    const store = createOperationApprovalStore();
    const approval = store.issue({
      projectRoot: '/project',
      repositoryIdentity: reviewedIdentity,
      plans: fixturePlan(),
    });
    assert.throws(
      () => store.consume(approval.token, { projectRoot: '/project', repositoryIdentity }),
      /repository identity|branch|HEAD|index|worktree|bound to/i,
    );
  }
});

test('approval store bounds outstanding capabilities and never stores raw bearer tokens as keys', () => {
  const store = createOperationApprovalStore({ maxEntries: 2, ttlMs: 60_000 });
  const repositoryIdentity = fixtureRepositoryIdentity();
  const expectation = { projectRoot: '/project', repositoryIdentity };
  const first = store.issue({ projectRoot: '/project', repositoryIdentity, plans: fixturePlan() });
  store.issue({ projectRoot: '/project', repositoryIdentity, plans: fixturePlan() });
  store.issue({ projectRoot: '/project', repositoryIdentity, plans: fixturePlan() });

  assert.equal(store.size(), 2);
  assert.throws(() => store.consume(first.token, expectation), /invalid|expired/i);
  assert.equal(store.debugTokenHashes().some((value) => value === first.token), false);
  assert.equal(store.debugTokenHashes().every((value) => /^[a-f0-9]{64}$/.test(value)), true);
});
