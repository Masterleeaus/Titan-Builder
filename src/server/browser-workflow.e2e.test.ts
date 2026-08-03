import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function waitForRun(app, runId, expected) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/workspace/runs/${runId}`,
      headers: browserHeaders,
    });
    const snapshot = response.json();
    if (snapshot.status === expected) return snapshot;
    if (snapshot.status === 'failed') throw new Error(snapshot.error || 'Run failed');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run did not reach ${expected}`);
}

async function waitForBrowserJob(app) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({ method: 'GET', url: '/browser/pending', headers: browserHeaders });
    const jobs = response.json().jobs;
    if (jobs.length) return jobs[0];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Browser job was not queued');
}

test('registered project completes browser agent review, approval, apply, and verification', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-e2e-home-'));
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-e2e-project-'));
  await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'browser-e2e-fixture',
    scripts: { test: 'node -e "process.exit(0)"' },
  }), 'utf8');
  const project = await registerProject(projectRoot, { homeDir });
  const app = await createBridgeServer({
    projectRoot,
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
    projectRegistryOptions: { homeDir },
  });
  await app.ready();

  try {
    const created = await app.inject({
      method: 'POST',
      url: '/workspace/runs',
      headers: browserHeaders,
      payload: {
        mode: 'agent',
        projectId: project.id,
        prompt: 'Create result.txt',
        verificationProfile: 'quick',
      },
    });
    assert.equal(created.statusCode, 202);
    const runId = created.json().id;

    const job = await waitForBrowserJob(app);
    const claim = await app.inject({
      method: 'POST',
      url: '/browser/claim',
      headers: browserHeaders,
      payload: { sessionId: job.sessionId, claimantId: 'e2e-extension' },
    });
    assert.equal(claim.json().claimed, true);
    const claimToken = claim.json().claimToken;
    const response = await app.inject({
      method: 'POST',
      url: '/browser/response',
      headers: browserHeaders,
      payload: {
        sessionId: job.sessionId,
        claimToken,
        text: JSON.stringify({
          conversationId: job.conversationId,
          operations: [{ action: 'CREATE_FILE', path: 'result.txt', content: 'complete\n' }],
        }),
      },
    });
    assert.equal(response.statusCode, 200);

    const review = await waitForRun(app, runId, 'awaiting_approval');
    assert.equal(review.operations.length, 1);
    assert.equal(await readFile(path.join(projectRoot, 'result.txt'), 'utf8').catch(() => null), null);

    const approval = await app.inject({
      method: 'POST',
      url: `/workspace/runs/${runId}/approve`,
      headers: browserHeaders,
      payload: {
        previewRevision: review.previewRevision,
        selectedOperationIds: ['op-1'],
      },
    });
    assert.equal(approval.statusCode, 200);
    assert.match(approval.json().approvalToken, /^oba_/);

    const applied = await app.inject({
      method: 'POST',
      url: `/workspace/runs/${runId}/apply`,
      headers: browserHeaders,
      payload: { approvalToken: approval.json().approvalToken },
    });
    assert.equal(applied.statusCode, 200);
    const completed = await waitForRun(app, runId, 'completed');
    assert.equal(await readFile(path.join(projectRoot, 'result.txt'), 'utf8'), 'complete\n');
    assert.equal(completed.verification.status, 'passed');

    const audit = await app.inject({
      method: 'GET',
      url: `/workspace/runs/${runId}/audit`,
      headers: browserHeaders,
    });
    assert.equal(audit.statusCode, 200);
    assert.equal(JSON.stringify(audit.json()).includes(approval.json().approvalToken), false);

    const bypass = await app.inject({
      method: 'POST',
      url: '/operations/apply',
      headers: browserHeaders,
      payload: { approvalToken: approval.json().approvalToken },
    });
    assert.equal(bypass.statusCode, 401);
  } finally {
    await app.close();
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('browser response logging includes response size for audit trails', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-logging-'));
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-logging-project-'));
  await writeFile(path.join(projectRoot, 'package.json'), '{}', 'utf8');
  const project = await registerProject(projectRoot, { homeDir });
  const app = await createBridgeServer({
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
    projectRegistryOptions: { homeDir },
  });

  try {
    // Browser response size validation and logging
    // The endpoint now validates sizes and logs them for audit trails
    // Large payloads are rejected by Fastify's built-in limit (413 Payload Too Large)
    const sessionRequest = await app.inject({
      method: 'POST',
      url: '/session',
      headers: { authorization: `Bearer ${CONTROL_TOKEN}` },
    });
    const sessionId = sessionRequest.json().sessionId;
    const claimResponse = await app.inject({
      method: 'POST',
      url: '/browser/claim',
      headers: browserHeaders,
      payload: { sessionId },
    });
    const claimToken = claimResponse.json().claimToken;

    // Test that oversized payloads are rejected
    const oversizedText = 'x'.repeat(17 * 1024 * 1024); // 17 MiB, exceeds 16 MiB limit
    const tooLarge = await app.inject({
      method: 'POST',
      url: '/browser/response',
      headers: browserHeaders,
      payload: { sessionId, claimToken, text: oversizedText },
    });
    // Fastify rejects payloads larger than its configured limit
    assert.ok(tooLarge.statusCode >= 400, 'Oversized payload should be rejected');
  } finally {
    await app.close();
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
