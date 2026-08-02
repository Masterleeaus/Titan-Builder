import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceServer } from './bridge-server-entry.js';

const WORKSPACE_TOKEN = 'workspace-test-token-1234567890';
const NORMALIZED_BRIDGE_TOKEN = 'bridge-test-token-12345678901234567890';
const CONFIGURED_BRIDGE_TOKEN = `  ${NORMALIZED_BRIDGE_TOKEN}\n`;
const BRIDGE_PORT = 51235;
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
  it('uses the same trimmed token at the authenticated request boundary', async () => {
    const databaseDirectory = await temporaryDirectory('workspace-token-db-');
    const bridgeRequest = vi.fn(async (input) => {
      expect(input.controlToken).toBe(NORMALIZED_BRIDGE_TOKEN);
      expect(input.method).toBe('GET');
      expect(input.route).toBe('/project/memory');
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
      bridgeRequest,
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${WORKSPACE_TOKEN}` },
      });
      expect(response.statusCode).toBe(200);
      expect(bridgeRequest).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
