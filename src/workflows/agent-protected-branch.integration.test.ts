import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { planOperations } from '../operations/index.ts';
import { createOperationApprovalStore } from '../server/operation-approvals.ts';
import {
  AgentApplicationError,
  createPlannedOperationRevision,
  prepareSelectedApproval,
} from './agent-application.ts';

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, {
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
}

async function createProject(branch: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-protected-branch-'));
  await runGit(projectRoot, ['init', '-b', branch]);
  await runGit(projectRoot, ['config', 'user.name', 'Titan Test']);
  await runGit(projectRoot, ['config', 'user.email', 'titan@example.invalid']);
  await writeFile(path.join(projectRoot, 'target.txt'), 'before\n', 'utf8');
  await runGit(projectRoot, ['add', 'target.txt']);
  await runGit(projectRoot, ['commit', '-m', 'initial']);
  return projectRoot;
}

async function preparedRun(projectRoot: string) {
  const operations = [
    { action: 'EDIT_FILE' as const, path: 'target.txt', content: 'after\n' },
  ];
  const previews = await planOperations(operations, projectRoot);
  return {
    runId: 'run-protected-branch-12345678',
    projectRoot,
    conversationId: 'conversation-protected-branch',
    operations,
    previews,
    previewRevision: createPlannedOperationRevision(projectRoot, previews),
  };
}

test('agent approval issuance rejects a configured protected branch', async () => {
  const projectRoot = await createProject('main');
  try {
    const prepared = await preparedRun(projectRoot);
    await assert.rejects(
      () => prepareSelectedApproval(
        prepared,
        ['op-1'],
        projectRoot,
        {
          approvals: createOperationApprovalStore(),
          protectedBranches: ['main', 'master'],
        },
      ),
      (error: unknown) =>
        error instanceof AgentApplicationError &&
        error.code === 'APPROVAL_INVALID' &&
        /protected branch.*main/i.test(error.message),
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('agent approval issuance remains allowed on feature branches and when policy is unconfigured', async () => {
  for (const [branch, protectedBranches] of [
    ['feature/review', ['main']],
    ['main', []],
  ] as const) {
    const projectRoot = await createProject(branch);
    try {
      const prepared = await preparedRun(projectRoot);
      const approval = await prepareSelectedApproval(
        prepared,
        ['op-1'],
        projectRoot,
        {
          approvals: createOperationApprovalStore(),
          protectedBranches,
        },
      );
      assert.match(approval.approvalToken, /^oba_/u);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }
});
