import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerProject } from '../projects/registry.ts';
import { createBridgeServer } from './index.ts';

const CONTROL_TOKEN = 'control-'.padEnd(56, 'a');
const BROWSER_TOKEN = 'browser-'.padEnd(56, 'b');
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnop';
const browserHeaders = {
  authorization: `Bearer ${BROWSER_TOKEN}`,
  origin: EXTENSION_ORIGIN,
};

async function waitForStatus(
  app: Awaited<ReturnType<typeof createBridgeServer>>,
  runId: string,
  expected: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/workspace/runs/${runId}`,
      headers: browserHeaders,
    });
    const snapshot = response.json() as Record<string, unknown>;
    if (snapshot.status === expected) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run did not reach ${expected}`);
}

async function removeFixture(directory: string): Promise<void> {
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 20,
  });
}

test('browser token creates ask and agent runs for registered projects only', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-workflow-home-'));
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-workflow-project-'));
  const project = await registerProject(projectRoot, { homeDir });
  const conversationId = crypto.randomUUID();
  let submission = 0;
  const app = await createBridgeServer({
    projectRoot,
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
    projectRegistryOptions: { homeDir },
    browserWorkflowSubmitAndWait: async (request) => {
      submission += 1;
      if (request.mode === 'ask') return '# Registered project';
      return JSON.stringify({
        conversationId: request.conversationId || conversationId,
        operations: [{ action: 'CREATE_FILE', path: 'note.txt', content: 'hello\n' }],
      });
    },
  });
  await app.ready();

  try {
    const ask = await app.inject({
      method: 'POST',
      url: '/workspace/runs',
      headers: browserHeaders,
      payload: { mode: 'ask', projectId: project.id, prompt: 'Explain this project' },
    });
    assert.equal(ask.statusCode, 202);
    const askRunId = ask.json().id as string;
    const askComplete = await waitForStatus(app, askRunId, 'completed');
    assert.equal(askComplete.responseText, '# Registered project');

    const agent = await app.inject({
      method: 'POST',
      url: '/workspace/runs',
      headers: browserHeaders,
      payload: { mode: 'agent', projectId: project.id, prompt: 'Create note' },
    });
    assert.equal(agent.statusCode, 202);
    const agentRunId = agent.json().id as string;
    const review = await waitForStatus(app, agentRunId, 'awaiting_approval');
    assert.equal(Array.isArray(review.operations), true);
    assert.match(String(review.previewRevision), /^[a-f0-9]{64}$/);
    assert.equal(submission, 2);

    const arbitraryRoot = await app.inject({
      method: 'POST',
      url: '/workspace/runs',
      headers: browserHeaders,
      payload: { mode: 'agent', projectId: projectRoot, prompt: 'Edit files' },
    });
    assert.equal(arbitraryRoot.statusCode, 404);

    const forbidden = await app.inject({
      method: 'POST',
      url: '/operations/apply',
      headers: browserHeaders,
      payload: { approvalToken: 'x' },
    });
    assert.equal(forbidden.statusCode, 401);
  } finally {
    await app.close();
    await removeFixture(homeDir);
    await removeFixture(projectRoot);
  }
});
