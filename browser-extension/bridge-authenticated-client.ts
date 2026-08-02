import {
  createBridgeChallenge,
  type BridgeIdentityPayload,
  type BridgeIdentityPin,
  verifyBridgeIdentity,
} from './bridge-identity-verifier.js';
import { parseLoopbackBridgeUrl } from './bridge-endpoint-policy.js';

const IDENTITY_RESPONSE_LIMIT_BYTES = 16 * 1024;

export class BridgeClientError extends Error {
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = 'BridgeClientError';
  }
}

export function createAuthenticatedBridgeClient(input: {
  bridgeUrl: string;
  controlToken: string;
}) {
  const baseUrl = parseLoopbackBridgeUrl(input.bridgeUrl);
  const controlToken = input.controlToken.trim();
  let pinnedIdentity: BridgeIdentityPin | undefined;

  return {
    baseUrl,
    async request(method: string, route: string, body?: unknown): Promise<Response> {
      const challenge = createBridgeChallenge();
      const healthUrl = new URL('/health', baseUrl);
      healthUrl.searchParams.set('challenge', challenge);
      const identityResponse = await fetch(healthUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
      });
      rejectRedirect(identityResponse, 'Bridge identity challenge');
      if (!identityResponse.ok) {
        throw new BridgeClientError(
          `Bridge identity challenge returned HTTP ${identityResponse.status}`,
        );
      }

      const identityText = await readBoundedText(
        identityResponse,
        IDENTITY_RESPONSE_LIMIT_BYTES,
      );
      let payload: BridgeIdentityPayload;
      try {
        payload = JSON.parse(identityText) as BridgeIdentityPayload;
      } catch {
        throw new BridgeClientError('Bridge identity response was not valid JSON');
      }

      try {
        pinnedIdentity = verifyBridgeIdentity({
          payload,
          challenge,
          controlToken,
          pinned: pinnedIdentity,
        });
      } catch (error) {
        throw new BridgeClientError(
          error instanceof Error ? error.message : 'Bridge identity verification failed',
        );
      }

      if (!route.startsWith('/') || route.startsWith('//')) {
        throw new BridgeClientError('Bridge route must be an absolute local path');
      }
      const target = new URL(route, baseUrl);
      if (target.origin !== baseUrl.origin || target.username || target.password) {
        throw new BridgeClientError('Bridge route escaped the authenticated loopback origin');
      }

      const response = await fetch(target, {
        method,
        redirect: 'manual',
        headers: {
          Authorization: `Bearer ${controlToken}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      rejectRedirect(response, 'Privileged bridge request');
      if (response.url && new URL(response.url).origin !== baseUrl.origin) {
        throw new BridgeClientError('Privileged bridge response changed origin');
      }
      return response;
    },
  };
}

function rejectRedirect(response: Response, label: string): void {
  if (response.status >= 300 && response.status < 400) {
    throw new BridgeClientError(`${label} returned a redirect`);
  }
}

async function readBoundedText(response: Response, limitBytes: number): Promise<string> {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limitBytes) {
    throw new BridgeClientError('Bridge identity response exceeded the size limit');
  }
  return bytes.toString('utf8');
}
