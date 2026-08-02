import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRepositoryApprovalPolicy,
  normalizeProtectedBranches,
} from './repository-identity.ts';
import type { RepositoryIdentity } from './repository-identity.ts';

function gitIdentity(branch: string | null): Extract<RepositoryIdentity, { kind: 'git' }> {
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
    branch,
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
  };
}

test('protected branch configuration is trimmed, deduplicated, and exact', () => {
  assert.deepEqual(
    normalizeProtectedBranches([' main ', 'release', 'main', '', ' release ']),
    ['main', 'release'],
  );

  assert.throws(
    () => assertRepositoryApprovalPolicy(gitIdentity('main'), ['main']),
    /protected branch.*main/i,
  );
  assert.doesNotThrow(() =>
    assertRepositoryApprovalPolicy(gitIdentity('main-feature'), ['main']),
  );
  assert.doesNotThrow(() =>
    assertRepositoryApprovalPolicy(gitIdentity('feature/review'), ['main', 'master']),
  );
});

test('protected branch policy is opt-in and does not invent policy for detached or non-Git projects', () => {
  assert.doesNotThrow(() => assertRepositoryApprovalPolicy(gitIdentity('main'), []));
  assert.doesNotThrow(() => assertRepositoryApprovalPolicy(gitIdentity(null), ['main']));
  assert.doesNotThrow(() =>
    assertRepositoryApprovalPolicy({
      kind: 'filesystem',
      projectRoot: '/project',
      projectRootIdentity: { device: '1', inode: '10' },
    }, ['main']),
  );
});
