import crypto from 'node:crypto';

export const BRIDGE_IDENTITY_PROTOCOL = 'openbrowser-bridge' as const;
export const BRIDGE_IDENTITY_VERSION = '1' as const;

const noncePattern = /^[a-f0-9]{64}$/u;
const instanceIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

export interface BridgeIdentityBinding {
  address: string;
  port: number;
}

export interface BridgeIdentityProof extends BridgeIdentityBinding {
  protocol: typeof BRIDGE_IDENTITY_PROTOCOL;
  version: typeof BRIDGE_IDENTITY_VERSION;
  instanceId: string;
  nonce: string;
  mac: string;
}

export function createBridgeIdentityProof(
  controlToken: string,
  nonce: string,
  instanceId: string,
  binding: BridgeIdentityBinding,
): BridgeIdentityProof {
  if (!controlToken) {
    throw new Error('Bridge identity proof requires the control token.');
  }
  if (!noncePattern.test(nonce)) {
    throw new Error('Bridge identity nonce must be 32 random bytes encoded as lowercase hexadecimal.');
  }
  if (!instanceIdPattern.test(instanceId)) {
    throw new Error('Bridge identity instance ID must be a UUID.');
  }

  const address = normalizeSocketAddress(binding.address);
  const port = normalizePort(binding.port);
  const unsigned = {
    protocol: BRIDGE_IDENTITY_PROTOCOL,
    version: BRIDGE_IDENTITY_VERSION,
    instanceId,
    nonce,
    address,
    port,
  } as const;

  return {
    ...unsigned,
    mac: crypto
      .createHmac('sha256', controlToken)
      .update(serializeBridgeIdentity(unsigned))
      .digest('hex'),
  };
}

export function serializeBridgeIdentity(
  proof: Omit<BridgeIdentityProof, 'mac'>,
): string {
  return JSON.stringify([
    proof.protocol,
    proof.version,
    proof.instanceId,
    proof.nonce,
    proof.address,
    proof.port,
  ]);
}

function normalizeSocketAddress(value: string): string {
  const normalized = String(value || '').trim().toLowerCase().replace(/^\[|\]$/gu, '');
  if (!normalized || /[\r\n\0]/u.test(normalized)) {
    throw new Error('Bridge identity requires a valid local socket address.');
  }
  return normalized;
}

function normalizePort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('Bridge identity requires a valid local socket port.');
  }
  return value;
}
