from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"Expected exactly one integration anchor in {path}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "browser-extension/bridge-server.ts",
    """import {
  assertSameTrustedOrigin,
  parseTrustedBridgeEndpoint,
  verifyBridgeIdentity,
} from './bridge-trust.js';""",
    """import {
  BridgeConnectionError,
  requestAuthenticatedBridge,
} from './bridge-connection-transport.js';
import { parseTrustedBridgeEndpoint } from './bridge-trust.js';""",
)
replace_once(
    "browser-extension/bridge-server.ts",
    """  bridgeAllowedPorts?: number[];
  bridgeFetch?: typeof fetch;
}""",
    """  bridgeAllowedPorts?: number[];
}""",
)
replace_once(
    "browser-extension/bridge-server.ts",
    """  const bridgeToken = options.bridgeToken ?? process.env.BRIDGE_TOKEN;
  const bridgeFetch = options.bridgeFetch ?? fetch;
  const databasePath = path.resolve(""",
    """  const bridgeToken = options.bridgeToken ?? process.env.BRIDGE_TOKEN;
  const databasePath = path.resolve(""",
)
replace_once(
    "browser-extension/bridge-server.ts",
    """    await verifyBridgeIdentity(bridgeEndpoint, bridgeToken, bridgeFetch);
    const response = await bridgeFetch(new URL(route, bridgeEndpoint.origin), {
      method,
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${bridgeToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    assertSameTrustedOrigin(response, bridgeEndpoint);
    const text = await response.text();""",
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
)

replace_once(
    "browser-extension/bridge-connection-transport.ts",
    """    if (identityResponse.socket.destroyed || !identityResponse.socket.writable) {
      throw new BridgeConnectionError(
        'Authenticated bridge connection closed before bearer delivery.',
      );
    }
""",
    """    const identityConnection = identityResponse.headers.get('connection')
      ?.split(',')
      .map((value) => value.trim().toLowerCase());
    if (
      identityConnection?.includes('close')
      || identityResponse.socket.destroyed
      || !identityResponse.socket.writable
    ) {
      throw new BridgeConnectionError(
        'Authenticated bridge connection closed before bearer delivery.',
      );
    }
""",
)

rebind_test = r"""

  it('does not disclose the bearer token to a replacement process on the approved port', async () => {
    const replacementAuthorizations: Array<string | undefined> = [];
    const firstServer = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/bridge/identity') {
        response.statusCode = 500;
        response.end();
        return;
      }
      const nonce = url.searchParams.get('nonce') ?? '';
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Connection', 'close');
      response.end(JSON.stringify(identityPayload({
        nonce,
        address: request.socket.localAddress ?? '127.0.0.1',
        port: request.socket.localPort ?? 0,
      })));
    });
    const listening = await listen(firstServer);
    const replacement = http.createServer((request, response) => {
      replacementAuthorizations.push(request.headers.authorization);
      response.end(JSON.stringify({ entries: [] }));
    });
    servers.push(replacement);

    const endpoint = parseTrustedBridgeEndpoint(listening.url, [listening.port]);
    await expect(requestAuthenticatedBridge({
      endpoint,
      controlToken: BRIDGE_TOKEN,
      method: 'GET',
      route: '/project/memory',
    })).rejects.toThrow(/connection (?:closed|changed)/i);

    if (firstServer.listening) {
      firstServer.closeAllConnections?.();
      firstServer.close();
      await once(firstServer, 'close');
    }
    replacement.listen(listening.port, '127.0.0.1');
    await once(replacement, 'listening');

    expect(replacementAuthorizations).toEqual([]);
  });
"""
transport_test = Path("browser-extension/bridge-connection-transport.test.ts")
transport_text = transport_test.read_text()
anchor = "\n  it('rejects route-origin escape before any network access', async () => {"
if rebind_test.strip() not in transport_text:
    if transport_text.count(anchor) != 1:
        raise SystemExit('Transport rebind test anchor was not found exactly once')
    transport_test.write_text(transport_text.replace(anchor, rebind_test + anchor, 1))

Path("browser-extension/bridge-instance-pinning.test.ts").write_text(r"""import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceServer } from './bridge-server.js';

const WORKSPACE_TOKEN = 'workspace-test-token-1234567890';
const BRIDGE_TOKEN = 'bridge-test-token-12345678901234567890';
const INSTANCE_A = '12345678-1234-4234-8234-123456789abc';
const INSTANCE_B = '87654321-4321-4321-8321-cba987654321';
const temporaryDirectories: string[] = [];
const servers: http.Server[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function signedIdentity(input: {
  nonce: string;
  instanceId: string;
  address: string;
  port: number;
}) {
  const unsigned = {
    protocol: 'openbrowser-bridge' as const,
    version: '1' as const,
    instanceId: input.instanceId,
    nonce: input.nonce,
    address: input.address,
    port: input.port,
  };
  return {
    ...unsigned,
    mac: crypto.createHmac('sha256', BRIDGE_TOKEN)
      .update(JSON.stringify([
        unsigned.protocol,
        unsigned.version,
        unsigned.instanceId,
        unsigned.nonce,
        unsigned.address,
        unsigned.port,
      ]))
      .digest('hex'),
  };
}

async function listen(server: http.Server): Promise<{ url: string; port: number }> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, port: address.port };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (!server.listening) return;
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close');
  }));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('bridge instance pinning', () => {
  it('refuses bearer forwarding after the authenticated bridge instance changes', async () => {
    const databaseDirectory = await temporaryDirectory('workspace-pinning-db-');
    let identityChecks = 0;
    let privilegedRequests = 0;
    const bridge = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/bridge/identity') {
        identityChecks += 1;
        const nonce = url.searchParams.get('nonce') ?? '';
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Connection', 'keep-alive');
        response.end(JSON.stringify(signedIdentity({
          nonce,
          instanceId: identityChecks === 1 ? INSTANCE_A : INSTANCE_B,
          address: request.socket.localAddress ?? '127.0.0.1',
          port: request.socket.localPort ?? 0,
        })));
        return;
      }

      privilegedRequests += 1;
      expect(request.headers.authorization).toBe(`Bearer ${BRIDGE_TOKEN}`);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ entries: [] }));
    });
    const listening = await listen(bridge);

    const app = await createWorkspaceServer({
      workspaceToken: WORKSPACE_TOKEN,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl: listening.url,
      bridgeAllowedPorts: [listening.port],
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
""")

Path("browser-extension/bridge-token-normalization.test.ts").write_text(r"""import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceServer } from './bridge-server-entry.js';

const WORKSPACE_TOKEN = 'workspace-test-token-1234567890';
const NORMALIZED_BRIDGE_TOKEN = 'bridge-test-token-12345678901234567890';
const CONFIGURED_BRIDGE_TOKEN = `  ${NORMALIZED_BRIDGE_TOKEN}\n`;
const INSTANCE_ID = '12345678-1234-4234-8234-123456789abc';
const temporaryDirectories: string[] = [];
const servers: http.Server[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function listen(server: http.Server): Promise<{ url: string; port: number }> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, port: address.port };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (!server.listening) return;
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close');
  }));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('bridge credential normalization', () => {
  it('uses the same trimmed token for the identity proof and Authorization header', async () => {
    const databaseDirectory = await temporaryDirectory('workspace-token-db-');
    const authorizations: Array<string | undefined> = [];
    const remotePorts: number[] = [];
    const bridge = http.createServer((request, response) => {
      remotePorts.push(request.socket.remotePort ?? -1);
      authorizations.push(request.headers.authorization);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/bridge/identity') {
        const nonce = url.searchParams.get('nonce') ?? '';
        const unsigned = {
          protocol: 'openbrowser-bridge' as const,
          version: '1' as const,
          instanceId: INSTANCE_ID,
          nonce,
          address: request.socket.localAddress ?? '127.0.0.1',
          port: request.socket.localPort ?? 0,
        };
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Connection', 'keep-alive');
        response.end(JSON.stringify({
          ...unsigned,
          mac: crypto.createHmac('sha256', NORMALIZED_BRIDGE_TOKEN)
            .update(JSON.stringify([
              unsigned.protocol,
              unsigned.version,
              unsigned.instanceId,
              unsigned.nonce,
              unsigned.address,
              unsigned.port,
            ]))
            .digest('hex'),
        }));
        return;
      }

      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ entries: [] }));
    });
    const listening = await listen(bridge);

    const app = await createWorkspaceServer({
      workspaceToken: WORKSPACE_TOKEN,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
      bridgeToken: CONFIGURED_BRIDGE_TOKEN,
      bridgeUrl: listening.url,
      bridgeAllowedPorts: [listening.port],
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${WORKSPACE_TOKEN}` },
      });
      expect(response.statusCode).toBe(200);
      expect(remotePorts).toHaveLength(2);
      expect(remotePorts[0]).toBe(remotePorts[1]);
      expect(authorizations).toEqual([undefined, `Bearer ${NORMALIZED_BRIDGE_TOKEN}`]);
    } finally {
      await app.close();
    }
  });
});
""")
