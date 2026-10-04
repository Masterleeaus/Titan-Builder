#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}: {old[:120]!r}')
    return source.replace(old, new, 1)


def repair_root_bridge() -> None:
    identity_source = """import crypto from 'node:crypto';

export const BRIDGE_IDENTITY_PROTOCOL = 'openbrowser-bridge' as const;
export const BRIDGE_IDENTITY_VERSION = '1' as const;
export const BRIDGE_IDENTITY_SERVICE = BRIDGE_IDENTITY_PROTOCOL;
export const BRIDGE_IDENTITY_PROTOCOL_VERSION = 1 as const;
export const BRIDGE_VERSION = '0.5.0';

const CHALLENGE_PATTERN = /^[0-9a-f]{64}$/iu;
const SOCKET_NONCE_PATTERN = /^[a-f0-9]{64}$/u;
const INSTANCE_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

export interface BridgeIdentityResponse {
  service: typeof BRIDGE_IDENTITY_SERVICE;
  protocolVersion: typeof BRIDGE_IDENTITY_PROTOCOL_VERSION;
  version: string;
  instanceId: string;
  challenge: string;
  proof: string;
}

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
    .update(`${BRIDGE_IDENTITY_SERVICE}\\0${version}\\0${input.instanceId}\\0${input.challenge}`)
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

export function createSocketBoundBridgeIdentityProof(
  controlToken: string,
  nonce: string,
  instanceId: string,
  binding: BridgeIdentityBinding,
): BridgeIdentityProof {
  if (!controlToken) throw new Error('Bridge identity proof requires the control token.');
  if (!SOCKET_NONCE_PATTERN.test(nonce)) {
    throw new Error('Bridge identity nonce must be 32 random bytes encoded as lowercase hexadecimal.');
  }
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
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
  const normalized = String(value || '').trim().toLowerCase().replace(/^\\[|\\]$/gu, '');
  if (!normalized || /[\\r\\n\\0]/u.test(normalized)) {
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
"""
    Path('src/server/bridge-identity.ts').write_text(identity_source, encoding='utf-8')

    path = Path('src/server/index.ts')
    source = path.read_text(encoding='utf-8')
    source = replace_once(
        source,
        "import {\n  createBridgeIdentityResponse,\n  isValidBridgeIdentityChallenge,\n} from './bridge-identity.js';\nimport { bridgeBodyLimit } from './body-limits.js';",
        "import {\n  createBridgeIdentityResponse,\n  createSocketBoundBridgeIdentityProof,\n  isValidBridgeIdentityChallenge,\n} from './bridge-identity.js';\nimport {\n  bridgeBodyLimit,\n  createPayloadTooLargeResponse,\n  isPayloadTooLargeError,\n  SMALL_BODY_LIMIT_BYTES,\n} from './body-limits.js';",
        'root bridge imports',
    )
    source = replace_once(
        source,
        "  const app = Fastify({\n    logger: false,\n    bodyLimit: 4_194_304,\n  });\n",
        "  const app = Fastify({\n    logger: false,\n    bodyLimit: SMALL_BODY_LIMIT_BYTES,\n  });\n"
        "  app.setErrorHandler<Error>((error, request, reply) => {\n"
        "    if (isPayloadTooLargeError(error)) {\n"
        "      return reply.code(413).send(createPayloadTooLargeResponse(request));\n"
        "    }\n"
        "    return reply.send(error);\n"
        "  });\n",
        'root bridge Fastify setup',
    )
    source = replace_once(
        source,
        "  app.get('/health', async (request, reply) => {",
        "  app.get('/bridge/identity', async (request, reply) => {\n"
        "    const { nonce } = request.query as { nonce?: unknown };\n"
        "    if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/u.test(nonce)) {\n"
        "      return reply.code(400).send({ error: 'Bridge identity nonce is invalid' });\n"
        "    }\n"
        "    if (!controlToken) {\n"
        "      return reply.code(503).send({ error: 'Bridge identity proof is unavailable' });\n"
        "    }\n"
        "    const address = request.socket.localAddress;\n"
        "    const port = request.socket.localPort;\n"
        "    if (!address || !port) {\n"
        "      return reply.code(503).send({ error: 'Bridge socket identity is unavailable' });\n"
        "    }\n"
        "    return createSocketBoundBridgeIdentityProof(\n"
        "      controlToken,\n"
        "      nonce,\n"
        "      bridgeInstanceId,\n"
        "      { address, port },\n"
        "    );\n"
        "  });\n\n"
        "  app.get('/health', async (request, reply) => {",
        'root bridge identity route',
    )
    path.write_text(source, encoding='utf-8')


def repair_companion() -> None:
    lock = subprocess.check_output([
        'git',
        'show',
        '51683d900f5f8958b2845ada252f468bb3aa6f6d:browser-extension/pnpm-lock.yaml',
    ])
    Path('browser-extension/pnpm-lock.yaml').write_bytes(lock)

    path = Path('browser-extension/bridge-server.ts')
    source = path.read_text(encoding='utf-8')
    replacements = [
        (
            "import { existsSync, readFileSync } from 'node:fs';",
            "import { existsSync } from 'node:fs';",
            'companion fs import',
        ),
        (
            "export { parseLoopbackBridgeUrl } from './bridge-endpoint-policy.js';\n",
            "export { parseLoopbackBridgeUrl } from './bridge-endpoint-policy.js';\n"
            "export { loadWorkspaceEnvironment as loadCompanionEnvironment } from './environment.js';\n",
            'companion environment export',
        ),
        (
            "const workspaceConfigPath = loadWorkspaceEnvironment();",
            "loadWorkspaceEnvironment();",
            'companion environment invocation',
        ),
        (
            "  bridgeRequest?: typeof requestAuthenticatedBridge;\n",
            "",
            'companion obsolete bridge option',
        ),
        (
            "  const explicit = options.databasePath ?? process.env.WORKSPACE_DB_PATH;\n",
            "  const configuredPath = process.env.WORKSPACE_DB_PATH?.trim();\n"
            "  const explicit = options.databasePath ?? (\n"
            "    configuredPath && !['undefined', 'null'].includes(configuredPath.toLowerCase())\n"
            "      ? configuredPath\n"
            "      : undefined\n"
            "  );\n",
            'companion database path',
        ),
        (
            "  const databasePath = path.resolve(\n"
            "    options.databasePath\n"
            "      ?? process.env.WORKSPACE_DB_PATH\n"
            "      ?? path.join(moduleDirectory, 'openbrowser-workspace.db'),\n"
            "  );\n"
            "  const bridgeUrl = bridgeEndpoint.origin;\n"
            "  const bridgeToken = options.bridgeToken ?? process.env.BRIDGE_TOKEN;\n"
            "  const databasePath = await resolveWorkspaceDatabasePath({ databasePath: options.databasePath });\n",
            "  const databasePath = await resolveWorkspaceDatabasePath({ databasePath: options.databasePath });\n",
            'companion duplicate bridge setup',
        ),
        (
            "    if (error instanceof WorkspaceHttpError) {\n"
            "      return reply.code(error.statusCode).send({ error: error.message });\n"
            "    }\n",
            "    if (error instanceof WorkspaceHttpError) {\n"
            "      return reply.code(error.statusCode).send({\n"
            "        error: error.statusCode >= 500 ? 'Workspace operation failed' : error.message,\n"
            "        detail: error.statusCode >= 500 ? error.message : undefined,\n"
            "      });\n"
            "    }\n",
            'companion error envelope',
        ),
    ]
    for old, new, label in replacements:
        source = replace_once(source, old, new, label)
    path.write_text(source, encoding='utf-8')


def main() -> None:
    repair_root_bridge()
    repair_companion()


if __name__ == '__main__':
    main()
