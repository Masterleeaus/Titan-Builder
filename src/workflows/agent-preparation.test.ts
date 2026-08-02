import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  prepareAgentRun,
  runAskWorkflow,
  type AgentSubmissionRequest,
} from './agent-preparation.ts';

function fixtureRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'openbrowser-agent-preparation-'));
}

test('prepareAgentRun parses and plans without executing file operations', async () => {
  const projectRoot = fixtureRoot();
  const conversationId = '11111111-1111-4111-8111-111111111111';

  const result = await prepareAgentRun(
    {
      projectRoot,
      task: 'create note',
      contextRefs: [],
      conversationId,
    },
    {
      submitAndWait: async () =>
        JSON.stringify({
          conversationId,
          operations: [
            { action: 'CREATE_FILE', path: 'note.txt', content: 'hello' },
          ],
        }),
    },
  );

  assert.equal(result.operations.length, 1);
  assert.equal(result.previews.length, 1);
  assert.equal(result.previews[0]?.operation.action, 'CREATE_FILE');
  assert.equal(existsSync(path.join(projectRoot, 'note.txt')), false);
  assert.equal(Object.isFrozen(result.operations), true);
  assert.equal(Object.isFrozen(result.previews), true);
});

test('prepareAgentRun retries invalid responses with the same conversation id', async () => {
  const projectRoot = fixtureRoot();
  const conversationId = '22222222-2222-4222-8222-222222222222';
  const requests: AgentSubmissionRequest[] = [];

  const result = await prepareAgentRun(
    {
      projectRoot,
      task: 'create retry note',
      contextRefs: [],
      conversationId,
    },
    {
      submitAndWait: async (request) => {
        requests.push(request);
        if (requests.length === 1) return 'not valid agent output';
        return JSON.stringify({
          conversationId,
          operations: [
            { action: 'CREATE_FILE', path: 'retry.txt', content: 'fixed' },
          ],
        });
      },
    },
  );

  assert.equal(result.previews.length, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map((request) => request.conversationId),
    [conversationId, conversationId],
  );
  assert.match(requests[1]?.message ?? '', /Validation Error/i);
});

test('runAskWorkflow returns the browser answer without writing project files', async () => {
  const projectRoot = fixtureRoot();
  const requests: AgentSubmissionRequest[] = [];

  const result = await runAskWorkflow(
    {
      projectRoot,
      prompt: 'Explain this empty project',
      contextRefs: [],
      conversationId: '33333333-3333-4333-8333-333333333333',
    },
    {
      submitAndWait: async (request) => {
        requests.push(request);
        return '# Answer\n\nNothing has been created.';
      },
    },
  );

  assert.equal(result.responseText, '# Answer\n\nNothing has been created.');
  assert.equal(result.markdownDraft, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.mode, 'ask');
  assert.deepEqual(readdirSync(projectRoot), []);
});
