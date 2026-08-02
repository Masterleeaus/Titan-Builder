import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  captureRepositoryIdentity,
  sameRepositoryIdentity,
} from './repository-identity.ts';

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  return stdout.trim();
}

async function createGitProject(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-repository-identity-'));
  await runGit(projectRoot, ['init', '-b', 'feature/review']);
  await runGit(projectRoot, ['config', 'user.name', 'Titan Test']);
  await runGit(projectRoot, ['config', 'user.email', 'titan@example.invalid']);
  await writeFile(path.join(projectRoot, 'target.txt'), 'same bytes\n', 'utf8');
  await runGit(projectRoot, ['add', 'target.txt']);
  await runGit(projectRoot, ['commit', '-m', 'initial']);
  return projectRoot;
}

test('captures canonical Git repository, common-dir, worktree, branch, HEAD, and index identity', async () => {
  const projectRoot = await createGitProject();
  try {
    const identity = await captureRepositoryIdentity(projectRoot);
    assert.equal(identity.kind, 'git');
    if (identity.kind !== 'git') return;

    assert.equal(identity.branch, 'feature/review');
    assert.match(identity.head, /^[a-f0-9]{40,64}$/u);
    assert.equal(path.resolve(identity.projectRoot), path.resolve(projectRoot));
    assert.equal(path.resolve(identity.repositoryRoot), path.resolve(projectRoot));
    assert.ok(path.isAbsolute(identity.commonDir));
    assert.ok(path.isAbsolute(identity.gitDir));
    assert.match(identity.indexDigest, /^(missing|[a-f0-9]{64})$/u);
    assert.match(identity.worktreeIdentity.device, /^\d+$/u);
    assert.match(identity.worktreeIdentity.inode, /^\d+$/u);
    assert.match(identity.commonDirIdentity.device, /^\d+$/u);
    assert.match(identity.commonDirIdentity.inode, /^\d+$/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('switching branches invalidates approval identity even when reviewed file bytes are identical', async () => {
  const projectRoot = await createGitProject();
  try {
    await runGit(projectRoot, ['branch', 'main']);
    const reviewed = await captureRepositoryIdentity(projectRoot);
    await runGit(projectRoot, ['switch', 'main']);
    const current = await captureRepositoryIdentity(projectRoot);

    assert.equal(reviewed.kind, 'git');
    assert.equal(current.kind, 'git');
    assert.equal(await runGit(projectRoot, ['show', 'HEAD:target.txt']), 'same bytes');
    assert.equal(sameRepositoryIdentity(reviewed, current), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('detached HEAD and staged index changes each invalidate approval identity', async () => {
  const projectRoot = await createGitProject();
  try {
    const reviewed = await captureRepositoryIdentity(projectRoot);
    await runGit(projectRoot, ['switch', '--detach']);
    const detached = await captureRepositoryIdentity(projectRoot);
    assert.equal(sameRepositoryIdentity(reviewed, detached), false);

    await runGit(projectRoot, ['switch', 'feature/review']);
    await writeFile(path.join(projectRoot, 'staged.txt'), 'staged\n', 'utf8');
    await runGit(projectRoot, ['add', 'staged.txt']);
    const staged = await captureRepositoryIdentity(projectRoot);
    assert.equal(sameRepositoryIdentity(reviewed, staged), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('linked worktrees share a common repository but have distinct worktree identities', async () => {
  const projectRoot = await createGitProject();
  const linkedRoot = `${projectRoot}-linked`;
  try {
    await runGit(projectRoot, ['worktree', 'add', '-b', 'feature/linked', linkedRoot]);
    const primary = await captureRepositoryIdentity(projectRoot);
    const linked = await captureRepositoryIdentity(linkedRoot);

    assert.equal(primary.kind, 'git');
    assert.equal(linked.kind, 'git');
    if (primary.kind !== 'git' || linked.kind !== 'git') return;

    assert.equal(primary.commonDir, linked.commonDir);
    assert.deepEqual(primary.commonDirIdentity, linked.commonDirIdentity);
    assert.notEqual(primary.gitDir, linked.gitDir);
    assert.equal(sameRepositoryIdentity(primary, linked), false);
  } finally {
    await runGit(projectRoot, ['worktree', 'remove', '--force', linkedRoot]).catch(() => undefined);
    await rm(linkedRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('repository reinitialization at the same path invalidates approval identity', async () => {
  const projectRoot = await createGitProject();
  try {
    const reviewed = await captureRepositoryIdentity(projectRoot);
    await rm(path.join(projectRoot, '.git'), { recursive: true, force: true });
    await runGit(projectRoot, ['init', '-b', 'feature/review']);
    await runGit(projectRoot, ['config', 'user.name', 'Titan Test']);
    await runGit(projectRoot, ['config', 'user.email', 'titan@example.invalid']);
    await runGit(projectRoot, ['add', 'target.txt']);
    await runGit(projectRoot, ['commit', '-m', 'reinitialized']);
    const current = await captureRepositoryIdentity(projectRoot);

    assert.equal(reviewed.kind, 'git');
    assert.equal(current.kind, 'git');
    assert.equal(sameRepositoryIdentity(reviewed, current), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('non-Git projects use root-generation identity and reject same-path replacement', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-project-generation-'));
  const displacedRoot = `${projectRoot}-displaced`;
  try {
    const reviewed = await captureRepositoryIdentity(projectRoot);
    await rename(projectRoot, displacedRoot);
    await mkdir(projectRoot);
    const current = await captureRepositoryIdentity(projectRoot);

    assert.equal(reviewed.kind, 'filesystem');
    assert.equal(current.kind, 'filesystem');
    assert.equal(sameRepositoryIdentity(reviewed, current), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(displacedRoot, { recursive: true, force: true });
  }
});
