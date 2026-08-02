import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBridgeServer } from './index.ts';

const CONTROL_TOKEN = 'control-'.padEnd(56, 'a');
const BROWSER_TOKEN = 'browser-'.padEnd(56, 'b');
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnop';

async function removeFixture(directory: string): Promise<void> {
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 20,
  });
}

test('authenticated control and browser clients can discover public tool metadata', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-tools-project-'));
  const app = await createBridgeServer({
    projectRoot,
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
  });
  await app.ready();

  try {
    for (const headers of [
      { authorization: `Bearer ${CONTROL_TOKEN}` },
      { authorization: `Bearer ${BROWSER_TOKEN}`, origin: EXTENSION_ORIGIN },
    ]) {
      const response = await app.inject({ method: 'GET', url: '/tools', headers });
      assert.equal(response.statusCode, 200);
      const payload = response.json() as {
        schemaVersion: string;
        tools: Array<Record<string, unknown>>;
        knowledge: Array<Record<string, unknown>>;
      };
      assert.equal(payload.schemaVersion, '1');
      assert.ok(payload.tools.some((tool) => tool.runtimeId === 'git.status'));
      assert.ok(payload.tools.some((tool) => tool.runtimeId === 'git.show'));
      assert.equal(payload.tools.length, payload.knowledge.length);

      const serialized = JSON.stringify(payload);
      assert.doesNotMatch(serialized, /"executable"|"resolver"|"cwd"|OPENBROWSER_|BRIDGE_TOKEN/u);
      assert.doesNotMatch(serialized, new RegExp(projectRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    }
  } finally {
    await app.close();
    await removeFixture(projectRoot);
  }
});

test('tool catalog rejects unauthenticated and normal-web-origin requests', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-tools-security-'));
  const app = await createBridgeServer({
    projectRoot,
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
  });
  await app.ready();

  try {
    const unauthenticated = await app.inject({ method: 'GET', url: '/tools' });
    assert.equal(unauthenticated.statusCode, 401);

    const maliciousOrigin = await app.inject({
      method: 'GET',
      url: '/tools',
      headers: {
        authorization: `Bearer ${BROWSER_TOKEN}`,
        origin: 'https://malicious.example',
      },
    });
    assert.equal(maliciousOrigin.statusCode, 403);
  } finally {
    await app.close();
    await removeFixture(projectRoot);
  }
});
