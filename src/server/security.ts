import crypto from 'node:crypto';

export interface BridgeAuthorizationInput {
  configuredToken?: string;
  authorization?: string;
}

export function isAllowedBridgeOrigin(origin?: string): boolean {
  if (!origin) {
    return true;
  }

  return origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
}

export function authorizeBridgeRequest(input: BridgeAuthorizationInput): boolean {
  const configuredToken = input.configuredToken?.trim();
  if (!configuredToken) {
    return true;
  }

  const expected = `Bearer ${configuredToken}`;
  const actual = input.authorization ?? '';
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);

  return (
    expectedBytes.length === actualBytes.length &&
    crypto.timingSafeEqual(expectedBytes, actualBytes)
  );
}
