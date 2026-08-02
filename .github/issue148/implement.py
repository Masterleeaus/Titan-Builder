from pathlib import Path

HELPER_TS = r"""import crypto from 'node:crypto';

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
"""


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected patch anchor not found in {path}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1))


Path("browser-extension/bridge-target-security.ts").write_text(HELPER_TS)

replace_once(
    "browser-extension/bridge-server.ts",
    "import { z } from 'zod';\n\nconfig();",
    "import { z } from 'zod';\nimport { TrustedBridgeEndpoint } from './bridge-target-security.js';\n\nconfig();",
)
replace_once(
    "browser-extension/bridge-server.ts",
    "  const bridgeUrl = (options.bridgeUrl ?? process.env.OPENBROWSER_BRIDGE_URL ?? DEFAULT_BRIDGE_URL)\n    .replace(/\\/$/, '');\n  const bridgeToken = options.bridgeToken ?? process.env.BRIDGE_TOKEN;",
    "  const bridgeToken = String(options.bridgeToken ?? process.env.BRIDGE_TOKEN ?? '').trim() || undefined;\n  const bridgeEndpoint = new TrustedBridgeEndpoint(\n    options.bridgeUrl ?? process.env.OPENBROWSER_BRIDGE_URL ?? DEFAULT_BRIDGE_URL,\n    bridgeToken ?? '',\n  );\n  const bridgeUrl = bridgeEndpoint.origin;",
)
old_request = """  async function bridgeRequest(method: string, route: string, body?: unknown): Promise<unknown> {
    if (!bridgeToken) {
      throw new WorkspaceHttpError('BRIDGE_TOKEN is required for main-bridge operations', 503);
    }
    const response = await fetch(`${bridgeUrl}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${bridgeToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
"""
new_request = """  async function bridgeRequest(method: string, route: string, body?: unknown): Promise<unknown> {
    if (!bridgeToken) {
      throw new WorkspaceHttpError('BRIDGE_TOKEN is required for main-bridge operations', 503);
    }
    try {
      await bridgeEndpoint.verifyIdentity();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new WorkspaceHttpError(`Bridge identity verification failed: ${detail}`, 502);
    }
    const target = bridgeEndpoint.resolveRoute(route);
    const response = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${bridgeToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    try {
      bridgeEndpoint.assertTrustedResponse(response, target);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new WorkspaceHttpError(`Privileged bridge response rejected: ${detail}`, 502);
    }
"""
replace_once("browser-extension/bridge-server.ts", old_request, new_request)

replace_once(
    "src/server/security.ts",
    "const MIN_TOKEN_CHARACTERS = 32;",
    "export const BRIDGE_IDENTITY_PRODUCT = 'openbrowser-bridge';\nexport const BRIDGE_IDENTITY_PROTOCOL_VERSION = 1;\nexport const BRIDGE_IDENTITY_CONTEXT = 'openbrowser-bridge-identity-v1';\n\nconst MIN_TOKEN_CHARACTERS = 32;",
)
replace_once(
    "src/server/security.ts",
    "export function createBridgeSecurityPolicy(\n",
    """export function createBridgeIdentityProof(
  controlToken: string,
  nonce: string,
  instanceId: string,
): string {
  return crypto.createHmac('sha256', controlToken)
    .update(
      `${BRIDGE_IDENTITY_CONTEXT}\\n${BRIDGE_IDENTITY_PROTOCOL_VERSION}\\n${nonce}\\n${instanceId}`,
    )
    .digest('hex');
}

export function createBridgeSecurityPolicy(
""",
)
replace_once(
    "src/server/security.ts",
    "  if (method.toUpperCase() === 'OPTIONS' || url === '/health') {",
    "  if (method.toUpperCase() === 'OPTIONS' || url === '/health' || url === '/identity') {",
)

replace_once(
    "src/server/index.ts",
    "  createBridgeSecurityPolicy,\n  parseAllowedExtensionOrigins,\n  resolveBridgeRouteScope,",
    "  BRIDGE_IDENTITY_PRODUCT,\n  BRIDGE_IDENTITY_PROTOCOL_VERSION,\n  createBridgeIdentityProof,\n  createBridgeSecurityPolicy,\n  parseAllowedExtensionOrigins,\n  resolveBridgeRouteScope,",
)
replace_once(
    "src/server/index.ts",
    "  const insecureDevelopment = options.allowInsecureDev ?? process.env.OPENBROWSER_INSECURE_DEV === '1';\n  const securityPolicy = createBridgeSecurityPolicy({\n    controlToken: options.controlToken ?? process.env.BRIDGE_TOKEN,",
    "  const insecureDevelopment = options.allowInsecureDev ?? process.env.OPENBROWSER_INSECURE_DEV === '1';\n  const controlToken = String(options.controlToken ?? process.env.BRIDGE_TOKEN ?? '').trim();\n  const bridgeInstanceId = crypto.randomUUID();\n  const securityPolicy = createBridgeSecurityPolicy({\n    controlToken: controlToken || undefined,",
)
identity_route = """  app.get('/identity', async (request, reply) => {
    const nonce = String((request.query as { nonce?: string }).nonce ?? '');
    if (!/^[a-f0-9]{64}$/u.test(nonce)) {
      return reply.code(400).send({ error: 'A 64-character hexadecimal nonce is required' });
    }
    if (!controlToken) {
      return reply.code(503).send({ error: 'Authenticated bridge identity is unavailable' });
    }
    reply.header('Cache-Control', 'no-store');
    return {
      product: BRIDGE_IDENTITY_PRODUCT,
      protocolVersion: BRIDGE_IDENTITY_PROTOCOL_VERSION,
      instanceId: bridgeInstanceId,
      nonce,
      proof: createBridgeIdentityProof(controlToken, nonce, bridgeInstanceId),
    };
  });

"""
replace_once(
    "src/server/index.ts",
    "  app.get('/health', async () => ({\n",
    identity_route + "  app.get('/health', async () => ({\n",
)

replace_once(
    "src/server/security.test.ts",
    "  createBridgeSecurityPolicy,\n  resolveBridgeRouteScope,",
    "  BRIDGE_IDENTITY_PRODUCT,\n  BRIDGE_IDENTITY_PROTOCOL_VERSION,\n  createBridgeIdentityProof,\n  createBridgeSecurityPolicy,\n  resolveBridgeRouteScope,",
)
replace_once(
    "src/server/security.test.ts",
    "  assert.equal(resolveBridgeRouteScope('GET', '/health'), 'public');",
    "  assert.equal(resolveBridgeRouteScope('GET', '/health'), 'public');\n  assert.equal(resolveBridgeRouteScope('GET', '/identity?nonce=test'), 'public');",
)
security_path = Path("src/server/security.test.ts")
security_text = security_path.read_text()
if "bridge identity proof is nonce- and instance-bound" not in security_text:
    security_text = security_text.replace(
        "import test from 'node:test';",
        "import crypto from 'node:crypto';\nimport test from 'node:test';",
        1,
    ) + r"""

test('bridge identity proof is nonce- and instance-bound', () => {
  const nonce = 'a'.repeat(64);
  const instanceId = '123e4567-e89b-42d3-a456-426614174000';
  const proof = createBridgeIdentityProof(CONTROL_TOKEN, nonce, instanceId);
  assert.match(proof, /^[a-f0-9]{64}$/u);
  assert.equal(BRIDGE_IDENTITY_PRODUCT, 'openbrowser-bridge');
  assert.equal(BRIDGE_IDENTITY_PROTOCOL_VERSION, 1);
  assert.notEqual(
    proof,
    createBridgeIdentityProof(CONTROL_TOKEN, 'b'.repeat(64), instanceId),
  );
  assert.notEqual(
    proof,
    createBridgeIdentityProof(CONTROL_TOKEN, nonce, crypto.randomUUID()),
  );
});
"""
    security_path.write_text(security_text)
