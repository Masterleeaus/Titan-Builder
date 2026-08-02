import crypto from 'node:crypto';

export const BRIDGE_IDENTITY_PRODUCT = 'openbrowser-bridge';
export const BRIDGE_IDENTITY_PROTOCOL_VERSION = 1;
export const BRIDGE_IDENTITY_CONTEXT = 'openbrowser-bridge-identity-v1';

const EXPLICIT_LOOPBACK_URL = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([0-9]{1,5})\/?$/iu;
const HEX_64 = /^[a-f0-9]{64}$/u;
const INSTANCE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

export class BridgeTargetSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeTargetSecurityError';
  }
}

export function normalizeTrustedBridgeUrl(value: string): URL {
  const raw = String(value ?? '').trim();
  const match = EXPLICIT_LOOPBACK_URL.exec(raw);
  if (!match) {
    throw new BridgeTargetSecurityError(
      'Bridge URL must be an explicit HTTP literal loopback endpoint such as '
      + 'http://127.0.0.1:5000 or http://[::1]:5000, without credentials, paths, queries, or fragments',
    );
  }
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new BridgeTargetSecurityError('Bridge URL contains an unsupported port');
  }
  const url = new URL(raw);
  url.pathname = '/';
  return url;
}

export function createBridgeIdentityProof(
  token: string,
  nonce: string,
  instanceId: string,
): string {
  return crypto.createHmac('sha256', token)
    .update(
      `${BRIDGE_IDENTITY_CONTEXT}\n${BRIDGE_IDENTITY_PROTOCOL_VERSION}\n${nonce}\n${instanceId}`,
    )
    .digest('hex');
}

export class TrustedBridgeEndpoint {
  readonly baseUrl: URL;
  readonly origin: string;
  private readonly token: string;
  private readonly fetchImplementation: typeof fetch;
  private pinnedInstanceId: string | undefined;

  constructor(
    rawUrl: string,
    token: string,
    fetchImplementation: typeof fetch = globalThis.fetch,
  ) {
    this.baseUrl = normalizeTrustedBridgeUrl(rawUrl);
    this.origin = this.baseUrl.origin;
    this.token = token;
    this.fetchImplementation = fetchImplementation;
  }

  resolveRoute(route: string): URL {
    if (!route.startsWith('/') || route.startsWith('//')) {
      throw new BridgeTargetSecurityError('Bridge route must be an absolute local path');
    }
    const target = new URL(route, this.baseUrl);
    if (target.origin !== this.origin) {
      throw new BridgeTargetSecurityError('Bridge route changed the approved loopback origin');
    }
    return target;
  }

  async verifyIdentity(): Promise<string> {
    if (!this.token) {
      throw new BridgeTargetSecurityError('BRIDGE_TOKEN is required for bridge identity verification');
    }
    const nonce = crypto.randomBytes(32).toString('hex');
    const identityUrl = new URL('/identity', this.baseUrl);
    identityUrl.searchParams.set('nonce', nonce);

    let response: Response;
    try {
      response = await this.fetchImplementation(identityUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BridgeTargetSecurityError(`Unable to verify bridge identity: ${detail}`);
    }

    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new BridgeTargetSecurityError('Bridge identity endpoint attempted a redirect');
    }
    if (!response.ok) {
      throw new BridgeTargetSecurityError(
        `Bridge identity endpoint returned HTTP ${response.status}`,
      );
    }
    const finalUrl = new URL(response.url);
    if (finalUrl.origin !== this.origin || finalUrl.pathname !== '/identity') {
      throw new BridgeTargetSecurityError('Bridge identity response came from an unapproved endpoint');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BridgeTargetSecurityError('Bridge identity response was not valid JSON');
    }
    if (!payload || typeof payload !== 'object') {
      throw new BridgeTargetSecurityError('Bridge identity response was malformed');
    }
    const identity = payload as Record<string, unknown>;
    const instanceId = String(identity.instanceId ?? '');
    const proof = String(identity.proof ?? '');
    if (
      identity.product !== BRIDGE_IDENTITY_PRODUCT
      || identity.protocolVersion !== BRIDGE_IDENTITY_PROTOCOL_VERSION
      || identity.nonce !== nonce
      || !INSTANCE_ID.test(instanceId)
      || !HEX_64.test(proof)
    ) {
      throw new BridgeTargetSecurityError('Bridge identity response did not match the required protocol');
    }

    const expectedProof = createBridgeIdentityProof(this.token, nonce, instanceId);
    if (!constantTimeEqual(proof, expectedProof)) {
      throw new BridgeTargetSecurityError('Bridge identity proof was invalid');
    }
    if (this.pinnedInstanceId && this.pinnedInstanceId !== instanceId) {
      throw new BridgeTargetSecurityError('Bridge service instance changed after it was pinned');
    }
    this.pinnedInstanceId = instanceId;
    return instanceId;
  }

  assertTrustedResponse(response: Response, target: URL): void {
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new BridgeTargetSecurityError('Privileged bridge request attempted a redirect');
    }
    const finalUrl = new URL(response.url);
    if (finalUrl.origin !== this.origin || finalUrl.pathname !== target.pathname) {
      throw new BridgeTargetSecurityError('Privileged bridge response came from an unapproved endpoint');
    }
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length
    && crypto.timingSafeEqual(leftBytes, rightBytes);
}
