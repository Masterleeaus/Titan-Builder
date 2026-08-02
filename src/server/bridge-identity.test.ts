import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  BRIDGE_IDENTITY_PROTOCOL,
  BRIDGE_IDENTITY_VERSION,
  createBridgeIdentityProof,
  serializeBridgeIdentity,
} from './bridge-identity.ts';

const TOKEN = 'control-'.padEnd(56, 'a');
const NONCE = 'ab'.repeat(32);
const INSTANCE_ID = '12345678-1234-4234-8234-123456789abc';

test('creates a nonce, instance, and socket-bound HMAC proof', () => {
  const proof = createBridgeIdentityProof(TOKEN, NONCE, INSTANCE_ID, {
    address: '[::1]',
    port: 5000,
  });

  assert.deepEqual(proof, {
    protocol: BRIDGE_IDENTITY_PROTOCOL,
    version: BRIDGE_IDENTITY_VERSION,
    instanceId: INSTANCE_ID,
    nonce: NONCE,
    address: '::1',
    port: 5000,
    mac: crypto
      .createHmac('sha256', TOKEN)
      .update(serializeBridgeIdentity({
        protocol: BRIDGE_IDENTITY_PROTOCOL,
        version: BRIDGE_IDENTITY_VERSION,
        instanceId: INSTANCE_ID,
        nonce: NONCE,
        address: '::1',
        port: 5000,
      }))
      .digest('hex'),
  });
});

test('rejects malformed nonce, instance, socket address, and port fields', () => {
  assert.throws(
    () => createBridgeIdentityProof(TOKEN, 'short', INSTANCE_ID, { address: '127.0.0.1', port: 5000 }),
    /nonce/i,
  );
  assert.throws(
    () => createBridgeIdentityProof(TOKEN, NONCE, 'not-an-instance', { address: '127.0.0.1', port: 5000 }),
    /instance/i,
  );
  assert.throws(
    () => createBridgeIdentityProof(TOKEN, NONCE, INSTANCE_ID, { address: '', port: 5000 }),
    /address/i,
  );
  assert.throws(
    () => createBridgeIdentityProof(TOKEN, NONCE, INSTANCE_ID, { address: '127.0.0.1', port: 0 }),
    /port/i,
  );
});
