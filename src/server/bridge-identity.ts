import crypto from 'node:crypto';

export const BRIDGE_IDENTITY_SERVICE = 'openbrowser-bridge';
export const BRIDGE_IDENTITY_PROTOCOL_VERSION = 1;
export const BRIDGE_VERSION = '0.5.0';

const CHALLENGE_PATTERN = /^[0-9a-f]{64}$/iu;

export interface BridgeIdentityResponse {
  service: typeof BRIDGE_IDENTITY_SERVICE;
  protocolVersion: typeof BRIDGE_IDENTITY_PROTOCOL_VERSION;
  version: string;
  instanceId: string;
  challenge: string;
  proof: string;
}

export function isValidBridgeIdentityChallenge(value: unknown): value is string {
  return typeof value === 'string' && CHALLENGE_PATTERN.test(value);
}

export function createBridgeIdentityProof(input: {
  controlToken: string;
  challenge: string;
  instanceId: string;
  version?: string;
}): string {
  const version = input.version ?? BRIDGE_VERSION;
  if (!input.controlToken) throw new Error('Control token is required for bridge identity');
  if (!isValidBridgeIdentityChallenge(input.challenge)) {
    throw new Error('A 64-character hexadecimal challenge is required');
  }
  if (!input.instanceId) throw new Error('Bridge instance id is required');

  return crypto
    .createHmac('sha256', input.controlToken)
    .update(
      `${BRIDGE_IDENTITY_SERVICE}\0${version}\0${input.instanceId}\0${input.challenge}`,
    )
    .digest('hex');
}

export function createBridgeIdentityResponse(input: {
  controlToken: string;
  challenge: string;
  instanceId: string;
  version?: string;
}): BridgeIdentityResponse {
  const version = input.version ?? BRIDGE_VERSION;
  return {
    service: BRIDGE_IDENTITY_SERVICE,
    protocolVersion: BRIDGE_IDENTITY_PROTOCOL_VERSION,
    version,
    instanceId: input.instanceId,
    challenge: input.challenge,
    proof: createBridgeIdentityProof({ ...input, version }),
  };
}
