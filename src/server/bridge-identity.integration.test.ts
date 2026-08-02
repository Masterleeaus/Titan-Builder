import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BRIDGE_IDENTITY_PROTOCOL,
  BRIDGE_IDENTITY_VERSION,
  serializeBridgeIdentity,
  type BridgeIdentityProof,
} from './bridge-identity.ts';
import { createBridgeServer } from './index.ts';

const CONTROL_TOKEN = 'control-'.padEnd(56, 'a');
const BROWSER_TOKEN = 'browser-'.padEnd(56, 'b');

test('public identity challenge binds its proof to the actual listening socket', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-bridge-identity-'));
  const app = await createBridgeServer({
    projectRoot,
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
  });

  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const nonce = 'ab'.repeat(32);
    const response = await fetch(`http://127.0.0.1:${address.port}/bridge/identity?nonce=${nonce}`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 200);

    const proof = await response.json() as BridgeIdentityProof;
    assert.equal(proof.protocol, BRIDGE_IDENTITY_PROTOCOL);
    assert.equal(proof.version, BRIDGE_IDENTITY_VERSION);
    assert.equal(proof.nonce, nonce);
    assert.equal(proof.address, '127.0.0.1');
    assert.equal(proof.port, address.port);
    assert.equal(
      proof.mac,
      crypto.createHmac('sha256', CONTROL_TOKEN)
        .update(serializeBridgeIdentity(proof))
        .digest('hex'),
    );

    const malformed = await fetch(`http://127.0.0.1:${address.port}/bridge/identity?nonce=short`);
    assert.equal(malformed.status, 400);
  } finally {
    await app.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
