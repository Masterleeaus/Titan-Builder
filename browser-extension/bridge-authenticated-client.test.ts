import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthenticatedBridgeClient } from './bridge-authenticated-client.js';

const BRIDGE_TOKEN = 'bridge-control-token-'.padEnd(56, 'b');
const servers: http.Server[] = [];

function identityProof(challenge: string, instanceId: string): string {
  return crypto
    .createHmac('sha256', BRIDGE_TOKEN)
    .update(`openbrowser-bridge\0${'0.5.0'}\0${instanceId}\0${challenge}`)
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
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close');
  }));
});

describe('authenticated bridge transport', () => {
  it('sends the privileged token only over the exact connection that proved identity', async () => {
    const instanceId = 'same-connection-instance';
    const remotePorts: number[] = [];
    const authorizations: Array<string | undefined> = [];
    const bridge = http.createServer((request, response) => {
      remotePorts.push(request.socket.remotePort ?? -1);
      authorizations.push(request.headers.authorization);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/health') {
        const challenge = url.searchParams.get('challenge') ?? '';
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Connection', 'keep-alive');
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

      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ entries: [] }));
    });
    const bridgeUrl = await listen(bridge);
    const client = createAuthenticatedBridgeClient({
      bridgeUrl,
      controlToken: BRIDGE_TOKEN,
    });

    const response = await client.request('GET', '/project/memory');

    expect(response.status).toBe(200);
    expect(remotePorts).toHaveLength(2);
    expect(remotePorts[0]).toBe(remotePorts[1]);
    expect(authorizations).toEqual([undefined, `Bearer ${BRIDGE_TOKEN}`]);
  });

  it('fails closed when the verified server closes the connection before authorization', async () => {
    const instanceId = 'closed-connection-instance';
    let privilegedRequests = 0;
    const authorizations: Array<string | undefined> = [];
    const bridge = http.createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/health') {
        const challenge = url.searchParams.get('challenge') ?? '';
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Connection', 'close');
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
    const client = createAuthenticatedBridgeClient({
      bridgeUrl,
      controlToken: BRIDGE_TOKEN,
    });

    await expect(client.request('GET', '/project/memory'))
      .rejects.toThrow(/connection (?:changed|closed)/i);
    expect(privilegedRequests).toBe(0);
    expect(authorizations).toEqual([undefined]);
  });

  it('aborts an oversized identity response before transmitting the token', async () => {
    const authorizations: Array<string | undefined> = [];
    let privilegedRequests = 0;
    const bridge = http.createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/health') {
        response.setHeader('Content-Type', 'application/json');
        response.write('{"padding":"');
        for (let index = 0; index < 20; index += 1) {
          response.write('x'.repeat(1_024));
        }
        response.end('"}');
        return;
      }

      privilegedRequests += 1;
      response.end(JSON.stringify({ entries: [] }));
    });
    const bridgeUrl = await listen(bridge);
    const client = createAuthenticatedBridgeClient({
      bridgeUrl,
      controlToken: BRIDGE_TOKEN,
    });

    await expect(client.request('GET', '/project/memory'))
      .rejects.toThrow(/size limit/i);
    expect(privilegedRequests).toBe(0);
    expect(authorizations).toEqual([undefined]);
  });

  it('rejects an escaping route before making a network request', async () => {
    const bridge = http.createServer(() => {
      throw new Error('The invalid route must fail before network access');
    });
    const bridgeUrl = await listen(bridge);
    const client = createAuthenticatedBridgeClient({
      bridgeUrl,
      controlToken: BRIDGE_TOKEN,
    });

    await expect(client.request('GET', '//attacker.example/stolen'))
      .rejects.toThrow(/absolute local path|escaped/i);
  });
});
