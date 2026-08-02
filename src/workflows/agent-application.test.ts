import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planOperations } from '../operations/index.ts';
import { createOperationApprovalStore } from '../server/operation-approvals.ts';
import {
  AgentApplicationError,
  applyApprovedAgentRun,
  createPlannedOperationRevision,
  prepareSelectedApproval,
} from './agent-application.ts';

async function fixtureRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'openbrowser-agent-application-'));
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
