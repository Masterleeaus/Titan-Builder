import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWorkspaceServer,
  parseLoopbackBridgeUrl,
} from './bridge-server.js';

const WORKSPACE_TOKEN = 'workspace-test-token-1234567890';
const BRIDGE_TOKEN = 'bridge-control-token-'.padEnd(56, 'b');
const servers: http.Server[] = [];

function identityProof(
  challenge: string,
  instanceId: string,
  version = '0.5.0',
): string {
  return crypto
    .createHmac('sha256', BRIDGE_TOKEN)
    .update(`openbrowser-bridge\0${version}\0${instanceId}\0${challenge}`)
    .digest('hex');
}

async function listen(server: http.Server): Promise<string> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (!server.listening) return;
    server.close();
    await once(server, 'close');
  }));
});

describe('companion bridge endpoint policy', () => {
  it('accepts canonical IPv4 and IPv6 loopback HTTP endpoints', () => {
    expect(parseLoopbackBridgeUrl('http://127.0.0.1:5000/').href)
      .toBe('http://127.0.0.1:5000/');
    expect(parseLoopbackBridgeUrl('http://[::1]:5000').href)
      .toBe('http://[::1]:5000/');
  });

  it.each([
    'https://127.0.0.1:5000',
    'http://example.com:5000',
    'http://127.0.0.1.evil.example:5000',
    'http://user:pass@127.0.0.1:5000',
    'http://127.0.0.1:5000/api',
    'http://127.0.0.1:5000/?target=elsewhere',
    'http://127.0.0.1:5000/#fragment',
  ])('rejects an unsafe bridge endpoint: %s', (value) => {
    expect(() => parseLoopbackBridgeUrl(value)).toThrow(/loopback|http|credentials|path|query|fragment/i);
  });
});

describe('authenticated bridge identity forwarding', () => {
  it('proves bridge identity without sending the control token, then authorizes the privileged request', async () => {
    const observed: Array<{ url: string; authorization?: string }> = [];
    const instanceId = crypto.randomUUID();
    const bridge = http.createServer((request, response) => {
      observed.push({
        url: request.url ?? '/',
        authorization: request.headers.authorization,
      });
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('Content-Type', 'application/json');

      if (url.pathname === '/health' && url.searchParams.has('challenge')) {
        const challenge = url.searchParams.get('challenge') ?? '';
        response.end(JSON.stringify({
          service: 'openbrowser-bridge',
          protocolVersion: 1,
          version: '0.5.0',
          instanceId,
          challenge,
          proof: identityProof(challenge, instanceId),
        }));
        return;
      }

      expect(request.headers.authorization).toBe(`Bearer ${BRIDGE_TOKEN}`);
      response.end(JSON.stringify({ entries: [] }));
    });
    const bridgeUrl = await listen(bridge);
    const app = await createWorkspaceServer({
      workspaceToken: WORKSPACE_TOKEN,
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl,
      databasePath: ':memory:',
    });

    try {
      const result = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${WORKSPACE_TOKEN}` },
      });
      expect(result.statusCode).toBe(200);
      expect(observed).toHaveLength(2);
      expect(observed[0]?.url).toMatch(/^\/health\?challenge=/);
      expect(observed[0]?.authorization).toBeUndefined();
      expect(observed[1]?.url).toBe('/project/memory');
      expect(observed[1]?.authorization).toBe(`Bearer ${BRIDGE_TOKEN}`);
    } finally {
      await app.close();
    }
  });

  it('rejects a forged identity before transmitting the control token', async () => {
    let privilegedRequests = 0;
    const observedAuthorization: Array<string | undefined> = [];
    const bridge = http.createServer((request, response) => {
      observedAuthorization.push(request.headers.authorization);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/health' && url.searchParams.has('challenge')) {
        const challenge = url.searchParams.get('challenge') ?? '';
        response.end(JSON.stringify({
          service: 'openbrowser-bridge',
          protocolVersion: 1,
          version: '0.5.0',
          instanceId: crypto.randomUUID(),
          challenge,
          proof: '0'.repeat(64),
        }));
        return;
      }
      privilegedRequests += 1;
      response.end(JSON.stringify({ entries: [] }));
    });
    const bridgeUrl = await listen(bridge);
    const app = await createWorkspaceServer({
      workspaceToken: WORKSPACE_TOKEN,
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl,
      databasePath: ':memory:',
    });

    try {
      const result = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${WORKSPACE_TOKEN}` },
      });
      expect(result.statusCode).toBe(502);
      expect(result.json().detail).toMatch(/identity proof/i);
      expect(privilegedRequests).toBe(0);
      expect(observedAuthorization).toEqual([undefined]);
    } finally {
      await app.close();
    }
  });

  it('pins the verified bridge instance and rejects a replacement before the next privileged request', async () => {
    let challengeCount = 0;
    let privilegedRequests = 0;
    const bridge = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/health' && url.searchParams.has('challenge')) {
        challengeCount += 1;
        const challenge = url.searchParams.get('challenge') ?? '';
        const instanceId = challengeCount === 1 ? 'instance-a' : 'instance-b';
        response.end(JSON.stringify({
          service: 'openbrowser-bridge',
          protocolVersion: 1,
          version: '0.5.0',
          instanceId,
          challenge,
          proof: identityProof(challenge, instanceId),
        }));
        return;
      }
      privilegedRequests += 1;
      response.end(JSON.stringify({ entries: [] }));
    });
    const bridgeUrl = await listen(bridge);
    const app = await createWorkspaceServer({
      workspaceToken: WORKSPACE_TOKEN,
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl,
      databasePath: ':memory:',
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
      expect(second.statusCode).toBe(502);
      expect(second.json().detail).toMatch(/instance changed/i);
      expect(privilegedRequests).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('does not follow redirects for privileged requests', async () => {
    let redirectedRequests = 0;
    const redirectTarget = http.createServer((_request, response) => {
      redirectedRequests += 1;
      response.end('unexpected');
    });
    const redirectTargetUrl = await listen(redirectTarget);
    const instanceId = 'redirect-test-instance';
    const bridge = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/health' && url.searchParams.has('challenge')) {
        const challenge = url.searchParams.get('challenge') ?? '';
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          service: 'openbrowser-bridge',
          protocolVersion: 1,
          version: '0.5.0',
          instanceId,
          challenge,
          proof: identityProof(challenge, instanceId),
        }));
        return;
      }
      response.statusCode = 302;
      response.setHeader('Location', `${redirectTargetUrl}/stolen`);
      response.end();
    });
    const bridgeUrl = await listen(bridge);
    const app = await createWorkspaceServer({
      workspaceToken: WORKSPACE_TOKEN,
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl,
      databasePath: ':memory:',
    });

    try {
      const result = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${WORKSPACE_TOKEN}` },
      });
      expect(result.statusCode).toBe(502);
      expect(result.json().detail).toMatch(/redirect/i);
      expect(redirectedRequests).toBe(0);
    } finally {
      await app.close();
    }
  });
});
