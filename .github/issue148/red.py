from pathlib import Path

path = Path("browser-extension/bridge-server.test.ts")
text = path.read_text()
text = text.replace(
    "import fs from 'node:fs/promises';",
    "import crypto from 'node:crypto';\nimport fs from 'node:fs/promises';\nimport http from 'node:http';\nimport type { AddressInfo } from 'node:net';",
    1,
)
marker = "describe('bridge target security'"
if marker not in text:
    text += r"""

const BRIDGE_TOKEN = 'bridge-control-'.padEnd(56, 'b');
const BRIDGE_IDENTITY_CONTEXT = 'openbrowser-bridge-identity-v1';

async function startBridgeFixture(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function testBridgeIdentityProof(nonce: string, instanceId: string): string {
  return crypto.createHmac('sha256', BRIDGE_TOKEN)
    .update(`${BRIDGE_IDENTITY_CONTEXT}\n1\n${nonce}\n${instanceId}`)
    .digest('hex');
}

describe('bridge target security', () => {
  it.each([
    'https://127.0.0.1:5000',
    'http://localhost:5000',
    'http://example.com:5000',
    'http://user:password@127.0.0.1:5000',
    'http://127.0.0.1:5000/admin',
    'http://127.0.0.1:5000?target=elsewhere',
    'http://127.0.0.1:5000#fragment',
    'http://[::ffff:127.0.0.1]:5000',
  ])('rejects untrusted bridge URL %s', async (bridgeUrl) => {
    const databaseDirectory = await temporaryDirectory('workspace-bridge-url-');
    let app: Awaited<ReturnType<typeof createWorkspaceServer>> | undefined;
    let failure: unknown;
    try {
      app = await createWorkspaceServer({
        workspaceToken: TOKEN,
        bridgeToken: BRIDGE_TOKEN,
        bridgeUrl,
        databasePath: path.join(databaseDirectory, 'workspace.db'),
      });
    } catch (error) {
      failure = error;
    } finally {
      await app?.close();
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error | undefined)?.message)).toMatch(/literal loopback/i);
  });

  it('never sends the control token to an unverified loopback endpoint', async () => {
    const requests: Array<{ url: string; authorization?: string }> = [];
    const fixture = await startBridgeFixture((request, response) => {
      requests.push({ url: request.url ?? '/', authorization: request.headers.authorization });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ product: 'impostor-service' }));
    });
    const databaseDirectory = await temporaryDirectory('workspace-unverified-');
    const app = await createWorkspaceServer({
      workspaceToken: TOKEN,
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl: fixture.url,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
    });

    try {
      const result = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(result.statusCode).toBe(502);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toMatch(/^\/identity\?nonce=[a-f0-9]{64}$/);
      expect(requests[0]?.authorization).toBeUndefined();
    } finally {
      await app.close();
      await fixture.close();
    }
  });

  it('authenticates and pins a legitimate literal-loopback bridge before forwarding', async () => {
    const instanceId = crypto.randomUUID();
    let identitySeen = false;
    let privilegedAuthorization: string | undefined;
    const fixture = await startBridgeFixture((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('content-type', 'application/json');
      if (requestUrl.pathname === '/identity') {
        identitySeen = true;
        const nonce = requestUrl.searchParams.get('nonce') ?? '';
        response.end(JSON.stringify({
          product: 'openbrowser-bridge',
          protocolVersion: 1,
          instanceId,
          nonce,
          proof: testBridgeIdentityProof(nonce, instanceId),
        }));
        return;
      }
      if (requestUrl.pathname === '/project/memory') {
        privilegedAuthorization = request.headers.authorization;
        response.end(JSON.stringify({ entries: [] }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not found' }));
    });
    const databaseDirectory = await temporaryDirectory('workspace-verified-');
    const app = await createWorkspaceServer({
      workspaceToken: TOKEN,
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl: fixture.url,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
    });

    try {
      const result = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ entries: [] });
      expect(identitySeen).toBe(true);
      expect(privilegedAuthorization).toBe(`Bearer ${BRIDGE_TOKEN}`);
    } finally {
      await app.close();
      await fixture.close();
    }
  });

  it('fails closed on redirects without forwarding the control token', async () => {
    const authorizations: Array<string | undefined> = [];
    const fixture = await startBridgeFixture((request, response) => {
      authorizations.push(request.headers.authorization);
      if (request.url === '/redirected') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ product: 'redirect-target' }));
        return;
      }
      response.statusCode = 302;
      response.setHeader('location', '/redirected');
      response.end();
    });
    const databaseDirectory = await temporaryDirectory('workspace-redirect-');
    const app = await createWorkspaceServer({
      workspaceToken: TOKEN,
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl: fixture.url,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
    });

    try {
      const result = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(result.statusCode).toBe(502);
      expect(authorizations).toEqual([undefined]);
    } finally {
      await app.close();
      await fixture.close();
    }
  });
});
"""
path.write_text(text)
