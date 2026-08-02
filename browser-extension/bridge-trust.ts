import crypto from 'node:crypto';
import { isIP } from 'node:net';

export const BRIDGE_IDENTITY_PROTOCOL = 'openbrowser-bridge' as const;
export const BRIDGE_IDENTITY_VERSION = '1' as const;
export const MAX_IDENTITY_RESPONSE_BYTES = 8 * 1024;

const DEFAULT_APPROVED_PORTS = [5000] as const;
const noncePattern = /^[a-f0-9]{64}$/u;
const macPattern = /^[a-f0-9]{64}$/u;
const instanceIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const pinnedBridgeInstances = new Map<string, string>();

class BridgeTrustError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'BridgeTrustError';
  }
}

export interface TrustedBridgeEndpoint {
  origin: string;
  hostname: string;
  port: number;
  identityAddress: string;
}

export interface VerifiedBridgeIdentity {
  protocol: typeof BRIDGE_IDENTITY_PROTOCOL;
  version: typeof BRIDGE_IDENTITY_VERSION;
  instanceId: string;
  nonce: string;
  address: string;
  port: number;
  mac: string;
}

export function parseTrustedBridgeEndpoint(
  value: string,
  approvedPorts: readonly number[] = DEFAULT_APPROVED_PORTS,
): TrustedBridgeEndpoint {
  const raw = String(value || '').trim();
  if (!raw || /[\r\n\0]/u.test(raw)) {
    throw new Error('OPENBROWSER_BRIDGE_URL must be a valid loopback HTTP endpoint.');
  }
  if (!raw.startsWith('http://')) {
    throw new Error('OPENBROWSER_BRIDGE_URL must use the canonical http:// scheme.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new Error('OPENBROWSER_BRIDGE_URL must be an absolute HTTP URL.', { cause: error });
  }

  const authority = raw.slice('http://'.length).split(/[/?#]/u, 1)[0] ?? '';
  if (url.protocol !== 'http:') {
    throw new Error('OPENBROWSER_BRIDGE_URL must use plain HTTP over the local loopback interface.');
  }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('OPENBROWSER_BRIDGE_URL must contain only a loopback origin with no credentials, path, query, or fragment.');
  }
  if (!authority || authority.includes('%') || authority.endsWith(':')) {
    throw new Error('OPENBROWSER_BRIDGE_URL must not use encoded, scoped, or malformed host syntax.');
  }

  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  const addressKind = isIP(hostname);
  if (addressKind === 0) {
    throw new Error('OPENBROWSER_BRIDGE_URL must use a literal loopback IP address; DNS names are not accepted.');
  }
  if (addressKind === 4 && extractRawHostname(authority).toLowerCase() !== hostname) {
    throw new Error('OPENBROWSER_BRIDGE_URL must use canonical dotted-decimal IPv4 syntax.');
  }

  const identityAddress = normalizeLoopbackAddress(hostname);
  if (!identityAddress) {
    throw new Error('OPENBROWSER_BRIDGE_URL must resolve directly to an IPv4 or IPv6 loopback address.');
  }

  const port = url.port ? Number(url.port) : 80;
  const allowed = new Set(approvedPorts.map(validateApprovedPort));
  if (!allowed.has(port)) {
    throw new Error(`OPENBROWSER_BRIDGE_URL port ${port} is not approved.`);
  }

  return {
    origin: url.origin,
    hostname,
    port,
    identityAddress,
  };
}

export function createBridgeIdentityNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function verifyBridgeIdentity(
  endpoint: TrustedBridgeEndpoint,
  controlToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<VerifiedBridgeIdentity> {
  if (!controlToken) {
    throw new Error('BRIDGE_TOKEN is required to authenticate the local bridge.');
  }

  const nonce = createBridgeIdentityNonce();
  const challengeUrl = new URL('/bridge/identity', endpoint.origin);
  challengeUrl.searchParams.set('nonce', nonce);
  const response = await fetchImplementation(challengeUrl, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  assertSameTrustedOrigin(response, endpoint);
  if (!response.ok) {
    throw new Error(`Bridge identity challenge failed with HTTP ${response.status}.`);
  }

  const responseText = await readLimitedResponseText(response, MAX_IDENTITY_RESPONSE_BYTES);
  let payload: unknown;
  try {
    payload = JSON.parse(responseText) as unknown;
  } catch (error) {
    throw new Error('Bridge identity challenge returned invalid JSON.', { cause: error });
  }

  return verifyBridgeIdentityPayload(endpoint, controlToken, nonce, payload);
}

export function verifyBridgeIdentityPayload(
  endpoint: TrustedBridgeEndpoint,
  controlToken: string,
  nonce: string,
  payload: unknown,
): VerifiedBridgeIdentity {
  if (!controlToken) {
    throw new Error('BRIDGE_TOKEN is required to authenticate the local bridge.');
  }
  if (!noncePattern.test(nonce)) {
    throw new Error('Bridge identity challenge nonce is invalid.');
  }
  if (!isIdentityPayload(payload)) {
    throw new Error('Bridge identity challenge returned an invalid payload.');
  }
  if (payload.protocol !== BRIDGE_IDENTITY_PROTOCOL || payload.version !== BRIDGE_IDENTITY_VERSION) {
    throw new Error('Bridge identity protocol or version is not supported.');
  }
  if (payload.nonce !== nonce || !noncePattern.test(payload.nonce)) {
    throw new Error('Bridge identity challenge nonce does not match the request.');
  }
  if (!instanceIdPattern.test(payload.instanceId) || !macPattern.test(payload.mac)) {
    throw new Error('Bridge identity challenge contains invalid identity fields.');
  }
  if (payload.port !== endpoint.port) {
    throw new Error('Bridge identity socket port does not match the configured endpoint.');
  }
  const responseAddress = normalizeLoopbackAddress(payload.address);
  if (!responseAddress || responseAddress !== endpoint.identityAddress) {
    throw new Error('Bridge identity socket address does not match the configured endpoint.');
  }

  const expectedMac = crypto
    .createHmac('sha256', controlToken)
    .update(serializeBridgeIdentity(payload))
    .digest('hex');
  if (!constantTimeEqual(payload.mac, expectedMac)) {
    throw new Error('Bridge identity proof could not be authenticated.');
  }

  assertPinnedBridgeInstance(endpoint, controlToken, payload.instanceId);
  return payload;
}

export function assertSameTrustedOrigin(
  response: Pick<Response, 'status' | 'redirected' | 'url'>,
  endpoint: TrustedBridgeEndpoint,
): void {
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    throw new Error('Bridge redirects are not allowed.');
  }
  if (response.url) {
    const responseUrl = new URL(response.url);
    if (responseUrl.origin !== endpoint.origin) {
      throw new Error('Bridge response origin does not match the authenticated endpoint.');
    }
  }
}

function assertPinnedBridgeInstance(
  endpoint: TrustedBridgeEndpoint,
  controlToken: string,
  instanceId: string,
): void {
  const key = crypto
    .createHash('sha256')
    .update(BRIDGE_IDENTITY_PROTOCOL)
    .update('\0')
    .update(BRIDGE_IDENTITY_VERSION)
    .update('\0')
    .update(endpoint.origin)
    .update('\0')
    .update(controlToken)
    .digest('hex');
  const pinnedInstanceId = pinnedBridgeInstances.get(key);
  if (pinnedInstanceId && pinnedInstanceId !== instanceId) {
    throw new BridgeTrustError(
      'Authenticated bridge instance changed; restart the workspace companion before forwarding privileged requests.',
      503,
    );
  }
  if (!pinnedInstanceId) {
    pinnedBridgeInstances.set(key, instanceId);
  }
}

function serializeBridgeIdentity(payload: Omit<VerifiedBridgeIdentity, 'mac'>): string {
  return JSON.stringify([
    payload.protocol,
    payload.version,
    payload.instanceId,
    payload.nonce,
    payload.address,
    payload.port,
  ]);
}

async function readLimitedResponseText(response: Response, maximumBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error('Bridge identity response exceeds the allowed size.');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new Error('Bridge identity response exceeds the allowed size.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

function normalizeLoopbackAddress(value: string): string | null {
  const address = stripIpv6Brackets(String(value || '').trim().toLowerCase());
  const ipv4 = parseIpv4(address);
  if (ipv4) {
    return ipv4[0] === 127 ? `ipv4:${ipv4.join('.')}` : null;
  }

  const ipv6 = parseIpv6(address);
  if (!ipv6) return null;
  const isIpv6Loopback = ipv6.slice(0, 7).every((group) => group === 0) && ipv6[7] === 1;
  if (isIpv6Loopback) return 'ipv6:::1';

  const isMapped = ipv6.slice(0, 5).every((group) => group === 0) && ipv6[5] === 0xffff;
  if (!isMapped) return null;
  const mapped = [ipv6[6] >> 8, ipv6[6] & 0xff, ipv6[7] >> 8, ipv6[7] & 0xff];
  return mapped[0] === 127 ? `ipv4:${mapped.join('.')}` : null;
}

function parseIpv4(value: string): number[] | null {
  if (isIP(value) !== 4) return null;
  const bytes = value.split('.').map(Number);
  return bytes.length === 4 && bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ? bytes
    : null;
}

function parseIpv6(value: string): number[] | null {
  if (isIP(value) !== 6 || value.includes('%')) return null;
  let source = value;
  const dottedSuffix = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/u.exec(source)?.[1];
  if (dottedSuffix) {
    const bytes = parseIpv4(dottedSuffix);
    if (!bytes) return null;
    source = source.slice(0, -dottedSuffix.length)
      + `${((bytes[0] ?? 0) << 8 | (bytes[1] ?? 0)).toString(16)}:${((bytes[2] ?? 0) << 8 | (bytes[3] ?? 0)).toString(16)}`;
  }

  const halves = source.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
    .map((group) => Number.parseInt(group || '0', 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

function extractRawHostname(authority: string): string {
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    return closingBracket > 0 ? authority.slice(1, closingBracket) : authority;
  }
  const separator = authority.lastIndexOf(':');
  return separator >= 0 ? authority.slice(0, separator) : authority;
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function validateApprovedPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid approved bridge port: ${port}`);
  }
  return port;
}

function isIdentityPayload(value: unknown): value is VerifiedBridgeIdentity {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as VerifiedBridgeIdentity).protocol === 'string'
    && typeof (value as VerifiedBridgeIdentity).version === 'string'
    && typeof (value as VerifiedBridgeIdentity).instanceId === 'string'
    && typeof (value as VerifiedBridgeIdentity).nonce === 'string'
    && typeof (value as VerifiedBridgeIdentity).address === 'string'
    && Number.isInteger((value as VerifiedBridgeIdentity).port)
    && typeof (value as VerifiedBridgeIdentity).mac === 'string'
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}
