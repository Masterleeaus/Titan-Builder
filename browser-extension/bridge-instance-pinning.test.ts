import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceServer } from './bridge-server.js';

const WORKSPACE_TOKEN = 'workspace-test-token-1234567890';
const BRIDGE_TOKEN = 'bridge-test-token-12345678901234567890';
const BRIDGE_PORT = 51234;
const INSTANCE_A = '12345678-1234-4234-8234-123456789abc';
const INSTANCE_B = '87654321-4321-4321-8321-cba987654321';
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function signedIdentity(nonce: string, instanceId: string): Response {
  const unsigned = {
    protocol: 'openbrowser-bridge',
    version: '1',
    instanceId,
    nonce,
    address: '127.0.0.1',
    port: BRIDGE_PORT,
  };
  const mac = crypto
    .createHmac('sha256', BRIDGE_TOKEN)
    .update(JSON.stringify([
      unsigned.protocol,
      unsigned.version,
      unsigned.instanceId,
      unsigned.nonce,
      unsigned.address,
      unsigned.port,
    ]))
    .digest('hex');
  return new Response(JSON.stringify({ ...unsigned, mac }), { status: 200 });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('bridge instance pinning', () => {
  it('refuses to send the control token after the authenticated bridge instance changes', async () => {
    const databaseDirectory = await temporaryDirectory('workspace-pinning-db-');
    let identityChecks = 0;
    let privilegedRequests = 0;

    const bridgeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/bridge/identity') {
        expect(init?.headers).toBeUndefined();
        const nonce = url.searchParams.get('nonce') ?? '';
        identityChecks += 1;
        return signedIdentity(nonce, identityChecks === 1 ? INSTANCE_A : INSTANCE_B);
      }

      privilegedRequests += 1;
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${BRIDGE_TOKEN}`);
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const app = await createWorkspaceServer({
      workspaceToken: WORKSPACE_TOKEN,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl: `http://127.0.0.1:${BRIDGE_PORT}`,
      bridgeAllowedPorts: [BRIDGE_PORT],
      bridgeFetch,
    });

    try {
      const first = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${WORKSPACE_TOKEN}` },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${WORKSPACE_TOKEN}` },
      });
      expect(second.statusCode).toBe(503);
      expect(second.json()).toMatchObject({
        detail: expect.stringMatching(/instance.*changed/i),
      });
      expect(identityChecks).toBe(2);
      expect(privilegedRequests).toBe(1);
    } finally {
      await app.close();
    }
  });
});
