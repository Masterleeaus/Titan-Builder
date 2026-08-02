import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createBridgeServer } from './index.js';
import { clearSessions } from './session-store.js';

const execFileAsync = promisify(execFile);
const CONTROL_TOKEN = 'control-'.padEnd(56, 'a');
const BROWSER_TOKEN = 'browser-'.padEnd(56, 'b');
const EXTENSION_A = 'chrome-extension://abcdefghijklmnop';
const EXTENSION_B = 'chrome-extension://qrstuvwxyzabcdef';

const controlHeaders = { authorization: `Bearer ${CONTROL_TOKEN}` };
const browserHeaders = {
  authorization: `Bearer ${BROWSER_TOKEN}`,
  origin: EXTENSION_A,
};

function createTestServer(projectRoot = process.cwd()) {
  return createBridgeServer({
    projectRoot,
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
  });
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

test.beforeEach(() => {
  clearSessions();
  delete process.env.BRIDGE_TOKEN;
  delete process.env.BRIDGE_BROWSER_TOKEN;
  delete process.env.OPENBROWSER_INSECURE_DEV;
});

test('bridge workflow recovers, claims, streams, and completes with scoped credentials', async () => {
  const app = await createTestServer();
  await app.ready();

  const created = await app.inject({
    method: 'POST',
    url: '/session/prompt',
    headers: controlHeaders,
    payload: {
      mode: 'ask',
      prompt: 'hello',
      systemPrompt: 'system',
      message: 'message',
      conversationId: 'conversation-1',
    },
  });
  assert.equal(created.statusCode, 200);
  const { sessionId } = created.json() as { sessionId: string };

  const pending = await app.inject({ method: 'GET', url: '/browser/pending', headers: browserHeaders });
  assert.equal(pending.statusCode, 200);
  assert.equal(pending.json().jobs[0].sessionId, sessionId);

  const claim = await app.inject({
    method: 'POST',
    url: '/browser/claim',
    headers: browserHeaders,
    payload: { sessionId, claimantId: 'test-tab' },
  });
  assert.equal(claim.statusCode, 200);
  const claimPayload = claim.json() as {
    claimed: boolean;
    claimToken: string;
    job: {
      message: string;
      promptBody: string;
      systemPrompt: string;
      promptInjectionCharLimit: number;
      promptFileComposerNote: string;
    };
  };
  assert.equal(claimPayload.claimed, true);
  assert.ok(claimPayload.claimToken);
  assert.equal(claimPayload.job.promptBody, 'message');
  assert.equal(claimPayload.job.message, 'message');
  assert.equal(claimPayload.job.systemPrompt, 'system');
  assert.ok(claimPayload.job.promptInjectionCharLimit > 0);
  assert.match(claimPayload.job.promptFileComposerNote, /attached/i);

  const duplicate = await app.inject({
    method: 'POST',
    url: '/browser/claim',
    headers: browserHeaders,
    payload: { sessionId, claimantId: 'other-tab' },
  });
  assert.equal(duplicate.json().claimed, false);

  const heartbeat = await app.inject({
    method: 'POST',
    url: '/browser/heartbeat',
    headers: browserHeaders,
    payload: { sessionId, claimToken: claimPayload.claimToken },
  });
  assert.equal(heartbeat.statusCode, 200);
  assert.equal(heartbeat.json().accepted, true);

  const chunk = await app.inject({
    method: 'POST',
    url: '/browser/chunk',
    headers: browserHeaders,
    payload: { sessionId, claimToken: claimPayload.claimToken, text: 'partial' },
  });
  assert.equal(chunk.statusCode, 200);

  const complete = await app.inject({
    method: 'POST',
    url: '/browser/response',
    headers: browserHeaders,
    payload: { sessionId, claimToken: claimPayload.claimToken, text: 'complete answer' },
  });
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.json().status, 'complete');

  const status = await app.inject({
    method: 'GET',
    url: `/session/${sessionId}/status`,
    headers: controlHeaders,
  });
  assert.deepEqual(status.json(), {
    sessionId,
    status: 'complete',
    mode: 'ask',
    response: 'complete answer',
  });

  const empty = await app.inject({ method: 'GET', url: '/browser/pending', headers: browserHeaders });
  assert.deepEqual(empty.json(), { jobs: [] });

  await app.close();
});

test('bridge scopes, origin pinning, and one-time operation approvals fail closed', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-bridge-security-'));
  const app = await createTestServer(projectRoot);
  await app.ready();

  try {
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);

    const missingAuth = await app.inject({ method: 'POST', url: '/session', payload: {} });
    assert.equal(missingAuth.statusCode, 401);

    const browserOnControl = await app.inject({
      method: 'POST',
      url: '/operations/preview',
      headers: browserHeaders,
      payload: { operations: [] },
    });
    assert.equal(browserOnControl.statusCode, 401);

    const pinned = await app.inject({ method: 'GET', url: '/browser/pending', headers: browserHeaders });
    assert.equal(pinned.statusCode, 200);

    const differentExtension = await app.inject({
      method: 'GET',
      url: '/browser/pending',
      headers: {
        authorization: `Bearer ${BROWSER_TOKEN}`,
        origin: EXTENSION_B,
      },
    });
    assert.equal(differentExtension.statusCode, 403);

    const normalWebsite = await app.inject({
      method: 'GET',
      url: '/project/status',
      headers: {
        authorization: `Bearer ${BROWSER_TOKEN}`,
        origin: 'https://malicious.example',
      },
    });
    assert.equal(normalWebsite.statusCode, 403);

    const preview = await app.inject({
      method: 'POST',
      url: '/operations/preview',
      headers: controlHeaders,
      payload: {
        operations: [{ action: 'CREATE_FILE', path: 'approved.txt', content: 'approved\n' }],
      },
    });
    assert.equal(preview.statusCode, 200);
    const previewPayload = preview.json() as {
      approval: { token: string; previewHash: string; expiresAt: number };
    };
    assert.match(previewPayload.approval.token, /^oba_/);
    assert.match(previewPayload.approval.previewHash, /^[a-f0-9]{64}$/);

    const rawApply = await app.inject({
      method: 'POST',
      url: '/operations/apply',
      headers: controlHeaders,
      payload: {
        operations: [{ action: 'CREATE_FILE', path: 'bypass.txt', content: 'bypass\n' }],
      },
    });
    assert.equal(rawApply.statusCode, 400);

    const applied = await app.inject({
      method: 'POST',
      url: '/operations/apply',
      headers: controlHeaders,
      payload: {
        approvalToken: previewPayload.approval.token,
        conversationId: 'approval-test',
      },
    });
    assert.equal(applied.statusCode, 200);
    assert.equal(await readFile(path.join(projectRoot, 'approved.txt'), 'utf8'), 'approved\n');

    const replay = await app.inject({
      method: 'POST',
      url: '/operations/apply',
      headers: controlHeaders,
      payload: { approvalToken: previewPayload.approval.token },
    });
    assert.equal(replay.statusCode, 403);
  } finally {
    await app.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('operation approval endpoint rejects branch changes with identical reviewed file state', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-approval-branch-'));
  await runGit(projectRoot, ['init', '-b', 'feature/review']);
  await runGit(projectRoot, ['config', 'user.name', 'Titan Test']);
  await runGit(projectRoot, ['config', 'user.email', 'titan@example.invalid']);
  await writeFile(path.join(projectRoot, 'tracked.txt'), 'same bytes\n', 'utf8');
  await runGit(projectRoot, ['add', 'tracked.txt']);
  await runGit(projectRoot, ['commit', '-m', 'initial']);
  await runGit(projectRoot, ['branch', 'main']);

  const app = await createTestServer(projectRoot);
  await app.ready();
  try {
    const preview = await app.inject({
      method: 'POST',
      url: '/operations/preview',
      headers: controlHeaders,
      payload: {
        operations: [{ action: 'CREATE_FILE', path: 'approved.txt', content: 'approved\n' }],
      },
    });
    assert.equal(preview.statusCode, 200);
    const token = (preview.json() as { approval: { token: string } }).approval.token;

    await runGit(projectRoot, ['switch', 'main']);
    const applied = await app.inject({
      method: 'POST',
      url: '/operations/apply',
      headers: controlHeaders,
      payload: { approvalToken: token },
    });

    assert.equal(applied.statusCode, 409);
    assert.match(String(applied.json().error), /repository identity|stale|branch/i);
    await assert.rejects(readFile(path.join(projectRoot, 'approved.txt'), 'utf8'), /ENOENT/u);
  } finally {
    await app.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
