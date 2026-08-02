import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIDGE_IDENTITY_PROTOCOL_VERSION,
  BRIDGE_IDENTITY_SERVICE,
  BRIDGE_VERSION,
  createBridgeIdentityProof,
  createBridgeIdentityResponse,
  isValidBridgeIdentityChallenge,
} from './bridge-identity.ts';

const CONTROL_TOKEN = 'control-'.padEnd(56, 'a');

test('bridge identity response proves possession of the control token', () => {
  const challenge = crypto.randomBytes(32).toString('hex');
  const instanceId = crypto.randomUUID();
  const identity = createBridgeIdentityResponse({
    controlToken: CONTROL_TOKEN,
    challenge,
    instanceId,
  });

  assert.equal(identity.service, BRIDGE_IDENTITY_SERVICE);
  assert.equal(identity.protocolVersion, BRIDGE_IDENTITY_PROTOCOL_VERSION);
  assert.equal(identity.version, BRIDGE_VERSION);
  assert.equal(identity.instanceId, instanceId);
  assert.equal(identity.challenge, challenge);
  assert.equal(
    identity.proof,
    createBridgeIdentityProof({
      controlToken: CONTROL_TOKEN,
      challenge,
      instanceId,
      version: BRIDGE_VERSION,
    }),
  );
});

test('bridge identity proof changes with the challenge, instance, version, and token', () => {
  const challenge = crypto.randomBytes(32).toString('hex');
  const base = createBridgeIdentityProof({
    controlToken: CONTROL_TOKEN,
    challenge,
    instanceId: 'instance-a',
  });

  assert.notEqual(base, createBridgeIdentityProof({
    controlToken: CONTROL_TOKEN,
    challenge: crypto.randomBytes(32).toString('hex'),
    instanceId: 'instance-a',
  }));
  assert.notEqual(base, createBridgeIdentityProof({
    controlToken: CONTROL_TOKEN,
    challenge,
    instanceId: 'instance-b',
  }));
  assert.notEqual(base, createBridgeIdentityProof({
    controlToken: CONTROL_TOKEN,
    challenge,
    instanceId: 'instance-a',
    version: '0.5.1',
  }));
  assert.notEqual(base, createBridgeIdentityProof({
    controlToken: `${CONTROL_TOKEN}different`,
    challenge,
    instanceId: 'instance-a',
  }));
});

test('bridge identity challenge validation rejects missing and malformed input', () => {
  assert.equal(isValidBridgeIdentityChallenge(undefined), false);
  assert.equal(isValidBridgeIdentityChallenge('not-random'), false);
  assert.equal(isValidBridgeIdentityChallenge('a'.repeat(63)), false);
  assert.equal(isValidBridgeIdentityChallenge('g'.repeat(64)), false);
  assert.equal(isValidBridgeIdentityChallenge('a'.repeat(64)), true);

  assert.throws(
    () => createBridgeIdentityProof({
      controlToken: CONTROL_TOKEN,
      challenge: 'not-random',
      instanceId: 'instance-a',
    }),
    /64-character hexadecimal challenge/i,
  );
});
