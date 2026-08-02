import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_IDENTITY_PROTOCOL,
  BRIDGE_IDENTITY_VERSION,
  assertSameTrustedOrigin,
  parseTrustedBridgeEndpoint,
  verifyBridgeIdentity,
} from './bridge-trust.js';

const TOKEN = 'control-'.padEnd(56, 'a');
const INSTANCE_ID = '12345678-1234-4234-8234-123456789abc';

function serializeIdentity(payload: {
  protocol: string;
  version: string;
  instanceId: string;
  nonce: string;
  address: string;
  port: number;
}): string {
  return JSON.stringify([
    payload.protocol,
    payload.version,
    payload.instanceId,
    payload.nonce,
    payload.address,
    payload.port,
  ]);
}

describe('trusted bridge endpoint parsing', () => {
  it('accepts literal IPv4, IPv6, and mapped loopback endpoints on approved ports', () => {
    expect(parseTrustedBridgeEndpoint('http://127.0.0.1:5000/')).toMatchObject({
      origin: 'http://127.0.0.1:5000',
      identityAddress: 'ipv4:127.0.0.1',
      port: 5000,
    });
    expect(parseTrustedBridgeEndpoint('http://127.12.34.56:5000')).toMatchObject({
      identityAddress: 'ipv4:127.12.34.56',
    });
    expect(parseTrustedBridgeEndpoint('http://[::1]:5000')).toMatchObject({
      identityAddress: 'ipv6:::1',
    });
    expect(parseTrustedBridgeEndpoint('http://[::ffff:127.0.0.1]:5000')).toMatchObject({
      identityAddress: 'ipv4:127.0.0.1',
    });
  });

  it('rejects external hosts, DNS aliases, numeric aliases, and malformed authority', () => {
    const rejected = [
      'https://127.0.0.1:5000',
      'HTTP://127.0.0.1:5000',
      'http:127.0.0.1:5000',
      'http://localhost:5000',
      'http://attacker.invalid:5000',
      'http://8.8.8.8:5000',
      'http://2130706433:5000',
      'http://0177.0.0.1:5000',
      'http://127.1:5000',
      'http://[::ffff:8.8.8.8]:5000',
      'http://user:pass@127.0.0.1:5000',
      'http://127.0.0.1:5000/path',
      'http://127.0.0.1:5000/?query=1',
      'http://127.0.0.1:5000/#fragment',
      'http://127.0.0.1:5001',
      'http://127.0.0.1:',
      'http://127%2e0%2e0%2e1:5000',
      'http://[::1%25lo0]:5000',
    ];

    for (const value of rejected) {
      expect(() => parseTrustedBridgeEndpoint(value)).toThrow();
    }
  });

  it('allows an explicit programmatic test port without broadening the default policy', () => {
    expect(parseTrustedBridgeEndpoint('http://127.0.0.1:51234', [51234]).port).toBe(51234);
    expect(() => parseTrustedBridgeEndpoint('http://127.0.0.1:51234')).toThrow(/not approved/i);
  });
});

describe('bridge identity verification', () => {
  it('sends no credential during the challenge and accepts a valid socket-bound proof', async () => {
    const endpoint = parseTrustedBridgeEndpoint('http://127.0.0.1:5000');
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.headers).toBeUndefined();
      expect(init?.redirect).toBe('manual');
      const url = new URL(String(input));
      const nonce = url.searchParams.get('nonce') ?? '';
      const unsigned = {
        protocol: BRIDGE_IDENTITY_PROTOCOL,
        version: BRIDGE_IDENTITY_VERSION,
        instanceId: INSTANCE_ID,
        nonce,
        address: '127.0.0.1',
        port: 5000,
      };
      return new Response(JSON.stringify({
        ...unsigned,
        mac: crypto.createHmac('sha256', TOKEN).update(serializeIdentity(unsigned)).digest('hex'),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(verifyBridgeIdentity(endpoint, TOKEN, fetchMock)).resolves.toMatchObject({
      instanceId: INSTANCE_ID,
      address: '127.0.0.1',
      port: 5000,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects unauthenticated, redirected, socket-mismatched, and oversized responses', async () => {
    const endpoint = parseTrustedBridgeEndpoint('http://127.0.0.1:5000');
    const signedResponse = (address: string, signingToken: string): typeof fetch => vi.fn(async (input) => {
      const nonce = new URL(String(input)).searchParams.get('nonce') ?? '';
      const unsigned = {
        protocol: BRIDGE_IDENTITY_PROTOCOL,
        version: BRIDGE_IDENTITY_VERSION,
        instanceId: INSTANCE_ID,
        nonce,
        address,
        port: 5000,
      };
      return new Response(JSON.stringify({
        ...unsigned,
        mac: crypto.createHmac('sha256', signingToken).update(serializeIdentity(unsigned)).digest('hex'),
      }), { status: 200 });
    });

    await expect(verifyBridgeIdentity(endpoint, TOKEN, signedResponse('127.0.0.1', 'wrong-token')))
      .rejects.toThrow(/authenticated/i);
    await expect(verifyBridgeIdentity(endpoint, TOKEN, signedResponse('127.0.0.2', TOKEN)))
      .rejects.toThrow(/address/i);
    await expect(verifyBridgeIdentity(endpoint, TOKEN, vi.fn(async () => new Response('', {
      status: 302,
      headers: { location: 'http://127.0.0.1:5001/bridge/identity' },
    }))))
      .rejects.toThrow(/redirect/i);
    await expect(verifyBridgeIdentity(endpoint, TOKEN, vi.fn(async () => new Response('x'.repeat(9_000), {
      status: 200,
    }))))
      .rejects.toThrow(/size/i);
  });

  it('rejects a privileged response from a different origin or any redirect', () => {
    const endpoint = parseTrustedBridgeEndpoint('http://127.0.0.1:5000');
    expect(() => assertSameTrustedOrigin({
      status: 200,
      redirected: false,
      url: 'http://127.0.0.1:5001/session/prompt',
    }, endpoint)).toThrow(/origin/i);
    expect(() => assertSameTrustedOrigin({
      status: 307,
      redirected: false,
      url: 'http://127.0.0.1:5000/session/prompt',
    }, endpoint)).toThrow(/redirect/i);
  });
});
