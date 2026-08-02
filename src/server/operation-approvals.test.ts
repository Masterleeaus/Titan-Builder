import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOperationApprovalStore,
} from './operation-approvals.ts';
import type { PlannedOperation } from '../operations/index.ts';

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

test('approval token is one-time, short lived, and bound to exact project and preview', () => {
  let now = 1_000;
  const store = createOperationApprovalStore({
    ttlMs: 5_000,
    now: () => now,
  });
  const plans = fixturePlan();
  const approval = store.issue({ projectRoot: '/project', plans });

  assert.match(approval.token, /^oba_/);
  assert.equal(approval.expiresAt, 6_000);
  assert.match(approval.previewHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(approval.riskSummary, { WRITE: 1 });

  plans[0]!.operation.path = 'tampered.txt';
  const consumed = store.consume(approval.token, '/project');
  assert.equal(consumed[0]?.operation.path, 'safe.txt');
  assert.throws(() => store.consume(approval.token, '/project'), /already used|invalid/i);

  const wrongRoot = store.issue({ projectRoot: '/project', plans: fixturePlan() });
  assert.throws(() => store.consume(wrongRoot.token, '/other'), /project root/i);

  const expired = store.issue({ projectRoot: '/project', plans: fixturePlan() });
  now = expired.expiresAt + 1;
  assert.throws(() => store.consume(expired.token, '/project'), /expired/i);
});

test('approval store bounds outstanding capabilities and never stores raw bearer tokens as keys', () => {
  const store = createOperationApprovalStore({ maxEntries: 2, ttlMs: 60_000 });
  const first = store.issue({ projectRoot: '/project', plans: fixturePlan() });
  store.issue({ projectRoot: '/project', plans: fixturePlan() });
  store.issue({ projectRoot: '/project', plans: fixturePlan() });

  assert.equal(store.size(), 2);
  assert.throws(() => store.consume(first.token, '/project'), /invalid|expired/i);
  assert.equal(store.debugTokenHashes().some((value) => value === first.token), false);
  assert.equal(store.debugTokenHashes().every((value) => /^[a-f0-9]{64}$/.test(value)), true);
});
