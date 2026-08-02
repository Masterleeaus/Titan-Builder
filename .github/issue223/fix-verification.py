from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"Expected exactly one verification anchor in {path}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "browser-extension/bridge-server.ts",
    """import {
  BridgeConnectionError,
  requestAuthenticatedBridge,
} from './bridge-connection-transport.js';""",
    """import { requestAuthenticatedBridge } from './bridge-connection-transport.js';""",
)
replace_once(
    "browser-extension/bridge-server.ts",
    """    let response: Response;
    try {
      response = await requestAuthenticatedBridge({
        endpoint: bridgeEndpoint,
        controlToken: bridgeToken,
        method,
        route,
        body,
      });
    } catch (error) {
      if (error instanceof BridgeConnectionError) {
        throw new WorkspaceHttpError(error.message, error.statusCode);
      }
      throw error;
    }
    const text = await response.text();""",
    """    const response = await requestAuthenticatedBridge({
      endpoint: bridgeEndpoint,
      controlToken: bridgeToken,
      method,
      route,
      body,
    });
    const text = await response.text();""",
)

server_test = Path("browser-extension/bridge-server.test.ts")
text = server_test.read_text()
text = text.replace(
    "import crypto from 'node:crypto';\nimport fs from 'node:fs/promises';",
    "import crypto from 'node:crypto';\nimport http from 'node:http';\nimport { once } from 'node:events';\nimport fs from 'node:fs/promises';\nimport type { AddressInfo } from 'node:net';",
    1,
)
text = text.replace(
    "import { afterEach, describe, expect, it, vi } from 'vitest';",
    "import { afterEach, describe, expect, it } from 'vitest';",
    1,
)
text = text.replace(
    "const TOKEN = 'workspace-test-token-1234567890';\nconst temporaryDirectories: string[] = [];",
    "const TOKEN = 'workspace-test-token-1234567890';\nconst temporaryDirectories: string[] = [];\nconst servers: http.Server[] = [];",
    1,
)
old_cleanup = """afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});"""
new_cleanup = """afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (!server.listening) return;
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close');
  }));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});"""
if text.count(old_cleanup) != 1:
    raise SystemExit('bridge-server cleanup anchor was not found exactly once')
text = text.replace(old_cleanup, new_cleanup, 1)

start = text.index("describe('authenticated bridge forwarding', () => {")
replacement = r"""describe('authenticated bridge forwarding', () => {
  it('proves bridge identity on the same connection before attaching the control token', async () => {
    const databaseDirectory = await temporaryDirectory('workspace-auth-db-');
    const bridgeToken = 'bridge-test-token-12345678901234567890';
    const instanceId = '12345678-1234-4234-8234-123456789abc';
    const remotePorts: number[] = [];
    const authorizations: Array<string | undefined> = [];
    const bridge = http.createServer((request, response) => {
      remotePorts.push(request.socket.remotePort ?? -1);
      authorizations.push(request.headers.authorization);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/bridge/identity') {
        const nonce = url.searchParams.get('nonce') ?? '';
        const unsigned = {
          protocol: 'openbrowser-bridge' as const,
          version: '1' as const,
          instanceId,
          nonce,
          address: request.socket.localAddress ?? '127.0.0.1',
          port: request.socket.localPort ?? 0,
        };
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Connection', 'keep-alive');
        response.end(JSON.stringify({
          ...unsigned,
          mac: crypto.createHmac('sha256', bridgeToken).update(JSON.stringify([
            unsigned.protocol,
            unsigned.version,
            unsigned.instanceId,
            unsigned.nonce,
            unsigned.address,
            unsigned.port,
          ])).digest('hex'),
        }));
        return;
      }

      expect(url.pathname).toBe('/session/prompt');
      request.resume();
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ sessionId: 'session-1', status: 'pending' }));
    });
    servers.push(bridge);
    bridge.listen(0, '127.0.0.1');
    await once(bridge, 'listening');
    const address = bridge.address() as AddressInfo;

    const app = await createWorkspaceServer({
      workspaceToken: TOKEN,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
      bridgeToken,
      bridgeUrl: `http://127.0.0.1:${address.port}`,
      bridgeAllowedPorts: [address.port],
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/prompt',
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { prompt: 'Inspect the project', mode: 'ask' },
      });
      expect(response.statusCode).toBe(200);
      expect(remotePorts).toHaveLength(2);
      expect(remotePorts[0]).toBe(remotePorts[1]);
      expect(authorizations).toEqual([undefined, `Bearer ${bridgeToken}`]);
    } finally {
      await app.close();
    }
  });
});
"""
text = text[:start] + replacement
server_test.write_text(text)
