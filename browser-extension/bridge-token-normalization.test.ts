import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceServer } from './bridge-server-entry.js';

const WORKSPACE_TOKEN = 'workspace-test-token-1234567890';
const NORMALIZED_BRIDGE_TOKEN = 'bridge-test-token-12345678901234567890';
const CONFIGURED_BRIDGE_TOKEN = `  ${NORMALIZED_BRIDGE_TOKEN}\n`;
const BRIDGE_PORT = 51235;
const INSTANCE_ID = '12345678-1234-4234-8234-123456789abc';
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('bridge credential normalization', () => {
  it('uses the same trimmed token for the identity proof and Authorization header', async () => {
    const databaseDirectory = await temporaryDirectory('workspace-token-db-');
    const bridgeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/bridge/identity') {
        expect(init?.headers).toBeUndefined();
        const nonce = url.searchParams.get('nonce') ?? '';
        const unsigned = {
          protocol: 'openbrowser-bridge',
          version: '1',
          instanceId: INSTANCE_ID,
          nonce,
          address: '127.0.0.1',
          port: BRIDGE_PORT,
        };
        return new Response(JSON.stringify({
          ...unsigned,
          mac: crypto
            .createHmac('sha256', NORMALIZED_BRIDGE_TOKEN)
            .update(JSON.stringify([
              unsigned.protocol,
              unsigned.version,
              unsigned.instanceId,
              unsigned.nonce,
              unsigned.address,
              unsigned.port,
            ]))
            .digest('hex'),
        }), { status: 200 });
      }

      expect((init?.headers as Record<string, string>).Authorization)
        .toBe(`Bearer ${NORMALIZED_BRIDGE_TOKEN}`);
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const app = await createWorkspaceServer({
      workspaceToken: WORKSPACE_TOKEN,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
      bridgeToken: CONFIGURED_BRIDGE_TOKEN,
      bridgeUrl: `http://127.0.0.1:${BRIDGE_PORT}`,
      bridgeAllowedPorts: [BRIDGE_PORT],
      bridgeFetch,
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${WORKSPACE_TOKEN}` },
      });
      expect(response.statusCode).toBe(200);
      expect(bridgeFetch).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
});
