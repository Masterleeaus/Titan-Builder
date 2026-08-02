import crypto from 'node:crypto';

const SERVICE = 'openbrowser-bridge';
const PROTOCOL_VERSION = 1;
const EXPECTED_VERSION = '0.5.0';
const HEX_64_PATTERN = /^[0-9a-f]{64}$/iu;

export interface BridgeIdentityPayload {
  service: string;
  protocolVersion: number;
  version: string;
  instanceId: string;
  challenge: string;
  proof: string;
}

export interface BridgeIdentityPin {
  instanceId: string;
  version: string;
}

export function createBridgeChallenge(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function verifyBridgeIdentity(input: {
  payload: BridgeIdentityPayload;
  challenge: string;
  controlToken: string;
  pinned?: BridgeIdentityPin;
}): BridgeIdentityPin {
  const { payload, challenge, controlToken, pinned } = input;
  if (
    payload?.service !== SERVICE
    || payload.protocolVersion !== PROTOCOL_VERSION
    || payload.version !== EXPECTED_VERSION
    || typeof payload.instanceId !== 'string'
    || payload.instanceId.length < 8
    || payload.challenge !== challenge
    || typeof payload.proof !== 'string'
    || !HEX_64_PATTERN.test(payload.proof)
  ) {
    throw new Error('Bridge identity response failed validation');
  }

  const expected = crypto
    .createHmac('sha256', controlToken)
    .update(`${SERVICE}\0${payload.version}\0${payload.instanceId}\0${challenge}`)
    .digest('hex');
  if (!constantTimeEqual(payload.proof, expected)) {
    throw new Error('Bridge identity proof is invalid');
  }

  if (
    pinned
    && (pinned.instanceId !== payload.instanceId || pinned.version !== payload.version)
  ) {
    throw new Error('Authenticated bridge instance changed');
  }

  return {
    instanceId: payload.instanceId,
    version: payload.version,
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length
    && crypto.timingSafeEqual(leftBytes, rightBytes);
}
