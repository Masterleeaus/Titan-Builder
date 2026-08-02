import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { planOperations } from '../operations/index.ts';
import { createOperationApprovalStore } from '../server/operation-approvals.ts';
import {
  AgentApplicationError,
  applyApprovedAgentRun,
  createPlannedOperationRevision,
  prepareSelectedApproval,
} from './agent-application.ts';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-agent-application-'));
  temporaryDirectories.push(root);
  return root;
}

async function gitFixtureRoot(): Promise<string> {
  const root = await fixtureRoot();
  await runGit(root, ['init', '-b', 'feature/review']);
  await runGit(root, ['config', 'user.name', 'Titan Test']);
  await runGit(root, ['config', 'user.email', 'titan@example.invalid']);
  await writeFile(path.join(root, 'target.txt'), 'before\n', 'utf8');
  await runGit(root, ['add', 'target.txt']);
  await runGit(root, ['commit', '-m', 'initial']);
  return root;
}

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

async function prepareFixture(projectRoot: string) {
  const conversationId = crypto.randomUUID();
  const operations = [
    { action: 'EDIT_FILE' as const, path: 'target.txt', content: 'after\n' },
  ];
  const previews = await planOperations(operations, projectRoot);
  return {
    runId: 'run-application-12345678',
    projectRoot,
    conversationId,
    operations,
    previews,
    previewRevision: createPlannedOperationRevision(projectRoot, previews),
  };
}

async function approveFixture(projectRoot: string) {
  const prepared = await prepareFixture(projectRoot);
  const approvals = createOperationApprovalStore();
  const approval = await prepareSelectedApproval(
    prepared,
    ['op-1'],
    projectRoot,
    { approvals },
  );
  return { prepared, approvals, approval };
}

async function assertRepositoryChangeRejected(
  projectRoot: string,
  mutateRepository: () => Promise<void>,
): Promise<void> {
  const { prepared, approvals, approval } = await approveFixture(projectRoot);
  await mutateRepository();

  await assert.rejects(
    () =>
      applyApprovedAgentRun(
        {
          runId: prepared.runId,
          projectRoot,
          conversationId: prepared.conversationId,
          approvalToken: approval.approvalToken,
          previewRevision: prepared.previewRevision,
          selectedOperationIds: ['op-1'],
        },
        { approvals },
      ),
    (error: unknown) =>
      error instanceof AgentApplicationError && error.code === 'STALE_PREVIEW',
  );

  assert.equal(await readFile(path.join(projectRoot, 'target.txt'), 'utf8'), 'before\n');
}

test('prepareSelectedApproval rejects when the filesystem no longer matches the reviewed preview', async () => {
  const projectRoot = await fixtureRoot();
  await writeFile(path.join(projectRoot, 'target.txt'), 'before\n', 'utf8');
  const prepared = await prepareFixture(projectRoot);
  await writeFile(path.join(projectRoot, 'target.txt'), 'changed elsewhere\n', 'utf8');

  await assert.rejects(
    () =>
      prepareSelectedApproval(
        prepared,
        ['op-1'],
        projectRoot,
        { approvals: createOperationApprovalStore() },
      ),
    (error: unknown) =>
      error instanceof AgentApplicationError && error.code === 'STALE_PREVIEW',
  );
});

test('applyApprovedAgentRun re-plans, applies once, and rejects token reuse', async () => {
  const projectRoot = await fixtureRoot();
  await writeFile(path.join(projectRoot, 'target.txt'), 'before\n', 'utf8');
  const prepared = await prepareFixture(projectRoot);
  const approvals = createOperationApprovalStore();
  const approval = await prepareSelectedApproval(
    prepared,
    ['op-1'],
    projectRoot,
    { approvals },
  );

  const result = await applyApprovedAgentRun(
    {
      runId: prepared.runId,
      projectRoot,
      conversationId: prepared.conversationId,
      approvalToken: approval.approvalToken,
      previewRevision: prepared.previewRevision,
      selectedOperationIds: ['op-1'],
    },
    { approvals },
  );

  assert.equal(await readFile(path.join(projectRoot, 'target.txt'), 'utf8'), 'after\n');
  assert.deepEqual(result.changedPaths, ['target.txt']);

  await assert.rejects(
    () =>
      applyApprovedAgentRun(
        {
          runId: prepared.runId,
          projectRoot,
          conversationId: prepared.conversationId,
          approvalToken: approval.approvalToken,
          previewRevision: prepared.previewRevision,
          selectedOperationIds: ['op-1'],
        },
        { approvals },
      ),
    /already used|invalid/i,
  );
});

test('approval is rejected after switching to another branch with identical target bytes', async () => {
  const projectRoot = await gitFixtureRoot();
  await runGit(projectRoot, ['branch', 'main']);
  await assertRepositoryChangeRejected(projectRoot, async () => {
    await runGit(projectRoot, ['switch', 'main']);
  });
});

test('approval is rejected after HEAD advances without changing target bytes', async () => {
  const projectRoot = await gitFixtureRoot();
  await assertRepositoryChangeRejected(projectRoot, async () => {
    await runGit(projectRoot, ['commit', '--allow-empty', '-m', 'advance head']);
  });
});

test('approval is rejected after the Git index changes', async () => {
  const projectRoot = await gitFixtureRoot();
  await assertRepositoryChangeRejected(projectRoot, async () => {
    await writeFile(path.join(projectRoot, 'staged.txt'), 'staged\n', 'utf8');
    await runGit(projectRoot, ['add', 'staged.txt']);
  });
});

test('approval is rejected when the reviewed branch becomes detached HEAD', async () => {
  const projectRoot = await gitFixtureRoot();
  await assertRepositoryChangeRejected(projectRoot, async () => {
    await runGit(projectRoot, ['switch', '--detach']);
  });
});
