import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { requestAuthenticatedBridge } from './bridge-connection-transport.js';
import { parseTrustedBridgeEndpoint } from './bridge-trust.js';

const BRIDGE_TOKEN = 'bridge-control-token-'.padEnd(56, 'b');
const INSTANCE_ID = 'd4ec16de-50c2-4abc-9d11-c8fabf0a8432';
const servers: http.Server[] = [];

function identityPayload(input: {
  nonce: string;
  address: string;
  port: number;
}) {
  const unsigned = {
    protocol: 'openbrowser-bridge' as const,
    version: '1' as const,
    instanceId: INSTANCE_ID,
    nonce: input.nonce,
    address: input.address,
    port: input.port,
  };
  return {
    ...unsigned,
    mac: crypto
      .createHmac('sha256', BRIDGE_TOKEN)
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
});

describe('connection-bound bridge authorization', () => {
  it('uses the exact identity connection for the privileged request', async () => {
    const remotePorts: number[] = [];
    const authorizations: Array<string | undefined> = [];
    const server = http.createServer((request, response) => {
      remotePorts.push(request.socket.remotePort ?? -1);
      authorizations.push(request.headers.authorization);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/bridge/identity') {
        const nonce = url.searchParams.get('nonce') ?? '';
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Connection', 'keep-alive');
        response.end(JSON.stringify(identityPayload({
          nonce,
          address: request.socket.localAddress ?? '127.0.0.1',
          port: request.socket.localPort ?? 0,
        })));
        return;
      }

      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ entries: [] }));
    });
    const listening = await listen(server);
    const endpoint = parseTrustedBridgeEndpoint(listening.url, [listening.port]);

    const response = await requestAuthenticatedBridge({
      endpoint,
      controlToken: BRIDGE_TOKEN,
      method: 'GET',
      route: '/project/memory',
    });

    expect(response.status).toBe(200);
    expect(remotePorts).toHaveLength(2);
    expect(remotePorts[0]).toBe(remotePorts[1]);
    expect(authorizations).toEqual([undefined, `Bearer ${BRIDGE_TOKEN}`]);
  });

  it('fails closed when the verified server closes before bearer delivery', async () => {
    let privilegedRequests = 0;
    const authorizations: Array<string | undefined> = [];
    const server = http.createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/bridge/identity') {
        const nonce = url.searchParams.get('nonce') ?? '';
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Connection', 'close');
        response.end(JSON.stringify(identityPayload({
          nonce,
          address: request.socket.localAddress ?? '127.0.0.1',
          port: request.socket.localPort ?? 0,
        })));
        return;
      }

      privilegedRequests += 1;
      response.end(JSON.stringify({ entries: [] }));
    });
    const listening = await listen(server);
    const endpoint = parseTrustedBridgeEndpoint(listening.url, [listening.port]);

    await expect(requestAuthenticatedBridge({
      endpoint,
      controlToken: BRIDGE_TOKEN,
      method: 'GET',
      route: '/project/memory',
    })).rejects.toThrow(/connection (?:closed|changed)/i);

    expect(privilegedRequests).toBe(0);
    expect(authorizations).toEqual([undefined]);
  });

  it('streams and rejects an oversized identity response before sending authorization', async () => {
    let privilegedRequests = 0;
    const authorizations: Array<string | undefined> = [];
    const server = http.createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/bridge/identity') {
        response.setHeader('Content-Type', 'application/json');
        response.write('{"padding":"');
        for (let index = 0; index < 10; index += 1) {
          response.write('x'.repeat(1_024));
        }
        response.end('"}');
        return;
      }

      privilegedRequests += 1;
      response.end(JSON.stringify({ entries: [] }));
    });
    const listening = await listen(server);
    const endpoint = parseTrustedBridgeEndpoint(listening.url, [listening.port]);

    await expect(requestAuthenticatedBridge({
      endpoint,
      controlToken: BRIDGE_TOKEN,
      method: 'GET',
      route: '/project/memory',
    })).rejects.toThrow(/size/i);

    expect(privilegedRequests).toBe(0);
    expect(authorizations).toEqual([undefined]);
  });

  it('rejects route-origin escape before any network access', async () => {
    let requests = 0;
    const server = http.createServer((_request, response) => {
      requests += 1;
      response.end();
    });
    const listening = await listen(server);
    const endpoint = parseTrustedBridgeEndpoint(listening.url, [listening.port]);

    await expect(requestAuthenticatedBridge({
      endpoint,
      controlToken: BRIDGE_TOKEN,
      method: 'GET',
      route: '//attacker.example/stolen',
    })).rejects.toThrow(/route|origin/i);
    expect(requests).toBe(0);
  });
});
