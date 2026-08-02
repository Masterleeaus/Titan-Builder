import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { requestAuthenticatedBridge } from './bridge-connection-transport.js';
import { parseTrustedBridgeEndpoint } from './bridge-trust.js';

const BRIDGE_TOKEN = 'bridge-test-token-12345678901234567890';
const INSTANCE_A = '12345678-1234-4234-8234-123456789abc';
const INSTANCE_B = '87654321-4321-4321-8321-cba987654321';
const servers: http.Server[] = [];

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

describe('bridge instance pinning', () => {
  it('refuses bearer delivery after the authenticated bridge instance changes', async () => {
    let identityChecks = 0;
    let privilegedRequests = 0;
    const authorizations: Array<string | undefined> = [];
    const server = http.createServer((request, response) => {
      authorizations.push(request.headers.authorization);
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
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ entries: [] }));
    });
    const listening = await listen(server);
    const endpoint = parseTrustedBridgeEndpoint(listening.url, [listening.port]);

    const first = await requestAuthenticatedBridge({
      endpoint,
      controlToken: BRIDGE_TOKEN,
      method: 'GET',
      route: '/project/memory',
    });
    expect(first.status).toBe(200);

    await expect(requestAuthenticatedBridge({
      endpoint,
      controlToken: BRIDGE_TOKEN,
      method: 'GET',
      route: '/project/memory',
    })).rejects.toThrow(/instance.*changed/i);

    expect(identityChecks).toBe(2);
    expect(privilegedRequests).toBe(1);
    expect(authorizations).toEqual([
      undefined,
      `Bearer ${BRIDGE_TOKEN}`,
      undefined,
    ]);
  });
});
