import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRipgrepArguments,
  createWorkspaceServer,
  createZipBuffer,
  normalizeExportName,
  normalizeRelativePath,
  resolveProjectPath,
} from './bridge-server.js';

const TOKEN = 'workspace-test-token-1234567890';
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('path security', () => {
  it('rejects traversal and absolute paths', () => {
    expect(() => normalizeRelativePath('../secret.txt')).toThrow(/traversal/i);
    expect(() => normalizeRelativePath('/etc/passwd')).toThrow(/absolute/i);
    expect(() => normalizeRelativePath('C:\\Windows\\system.ini')).toThrow(/absolute/i);
  });

  it('normalizes safe export names', () => {
    expect(normalizeExportName('./reports/result.json')).toBe('reports/result.json');
    expect(() => normalizeExportName('.')).toThrow(/identify a file/i);
  });

  it('rejects a symlinked path segment', async () => {
    const root = await temporaryDirectory('workspace-root-');
    const outside = await temporaryDirectory('workspace-outside-');
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');

    try {
      await fs.symlink(outside, path.join(root, 'linked'), 'dir');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    await expect(resolveProjectPath(root, 'linked/secret.txt')).rejects.toThrow(/symbolic-link/i);
  });
});

describe('external command construction', () => {
  it('passes search input as an argument rather than a shell command', () => {
    expect(buildRipgrepArguments('hello; rm -rf /', '.', false)).toEqual([
      '--json',
      '--ignore-case',
      '--line-number',
      '--column',
      '--max-count',
      '500',
      '--fixed-strings',
      '--',
      'hello; rm -rf /',
      '.',
    ]);
  });
});

describe('ZIP export', () => {
  it('creates an archive and rejects case-insensitive duplicate names', async () => {
    const archive = await createZipBuffer([{ name: 'src/index.ts', content: 'export {};' }]);
    expect(archive.subarray(0, 2).toString('binary')).toBe('PK');

    await expect(createZipBuffer([
      { name: 'README.md', content: 'one' },
      { name: 'readme.md', content: 'two' },
    ])).rejects.toThrow(/duplicate export path/i);
  });
});

describe('workspace server', () => {
  it('keeps health public and protects project routes', async () => {
    const root = await temporaryDirectory('workspace-project-');
    const databaseDirectory = await temporaryDirectory('workspace-db-');
    await fs.writeFile(path.join(root, 'package.json'), '{}');

    const app = await createWorkspaceServer({
      workspaceToken: TOKEN,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
    });

    try {
      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ status: 'ok', version: '1.0.0' });

      const unauthorized = await app.inject({ method: 'GET', url: '/projects' });
      expect(unauthorized.statusCode).toBe(401);

      const registered = await app.inject({
        method: 'POST',
        url: '/projects/register-current',
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { root, name: 'Fixture Project' },
      });
      expect(registered.statusCode).toBe(200);
      expect(registered.json()).toMatchObject({
        project: {
          name: 'Fixture Project',
          root: await fs.realpath(root),
        },
      });

      const projects = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(projects.statusCode).toBe(200);
      expect(projects.json().projects).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});


const BRIDGE_TOKEN = 'bridge-control-'.padEnd(56, 'b');
const BRIDGE_IDENTITY_CONTEXT = 'openbrowser-bridge-identity-v1';

async function startBridgeFixture(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function testBridgeIdentityProof(nonce: string, instanceId: string): string {
  return crypto.createHmac('sha256', BRIDGE_TOKEN)
    .update(`${BRIDGE_IDENTITY_CONTEXT}\n1\n${nonce}\n${instanceId}`)
    .digest('hex');
}

describe('bridge target security', () => {
  it.each([
    'https://127.0.0.1:5000',
    'http://localhost:5000',
    'http://example.com:5000',
    'http://user:password@127.0.0.1:5000',
    'http://127.0.0.1:5000/admin',
    'http://127.0.0.1:5000?target=elsewhere',
    'http://127.0.0.1:5000#fragment',
    'http://[::ffff:127.0.0.1]:5000',
  ])('rejects untrusted bridge URL %s', async (bridgeUrl) => {
    const databaseDirectory = await temporaryDirectory('workspace-bridge-url-');
    let app: Awaited<ReturnType<typeof createWorkspaceServer>> | undefined;
    let failure: unknown;
    try {
      app = await createWorkspaceServer({
        workspaceToken: TOKEN,
        bridgeToken: BRIDGE_TOKEN,
        bridgeUrl,
        databasePath: path.join(databaseDirectory, 'workspace.db'),
      });
    } catch (error) {
      failure = error;
    } finally {
      await app?.close();
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error | undefined)?.message)).toMatch(/literal loopback/i);
  });

  it('never sends the control token to an unverified loopback endpoint', async () => {
    const requests: Array<{ url: string; authorization?: string }> = [];
    const fixture = await startBridgeFixture((request, response) => {
      requests.push({ url: request.url ?? '/', authorization: request.headers.authorization });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ product: 'impostor-service' }));
    });
    const databaseDirectory = await temporaryDirectory('workspace-unverified-');
    const app = await createWorkspaceServer({
      workspaceToken: TOKEN,
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl: fixture.url,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
    });

    try {
      const result = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(result.statusCode).toBe(502);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toMatch(/^\/identity\?nonce=[a-f0-9]{64}$/);
      expect(requests[0]?.authorization).toBeUndefined();
    } finally {
      await app.close();
      await fixture.close();
    }
  });

  it('authenticates and pins a legitimate literal-loopback bridge before forwarding', async () => {
    const instanceId = crypto.randomUUID();
    let identitySeen = false;
    let privilegedAuthorization: string | undefined;
    const fixture = await startBridgeFixture((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('content-type', 'application/json');
      if (requestUrl.pathname === '/identity') {
        identitySeen = true;
        const nonce = requestUrl.searchParams.get('nonce') ?? '';
        response.end(JSON.stringify({
          product: 'openbrowser-bridge',
          protocolVersion: 1,
          instanceId,
          nonce,
          proof: testBridgeIdentityProof(nonce, instanceId),
        }));
        return;
      }
      if (requestUrl.pathname === '/project/memory') {
        privilegedAuthorization = request.headers.authorization;
        response.end(JSON.stringify({ entries: [] }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not found' }));
    });
    const databaseDirectory = await temporaryDirectory('workspace-verified-');
    const app = await createWorkspaceServer({
      workspaceToken: TOKEN,
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl: fixture.url,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
    });

    try {
      const result = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ entries: [] });
      expect(identitySeen).toBe(true);
      expect(privilegedAuthorization).toBe(`Bearer ${BRIDGE_TOKEN}`);
    } finally {
      await app.close();
      await fixture.close();
    }
  });

  it('fails closed on redirects without forwarding the control token', async () => {
    const authorizations: Array<string | undefined> = [];
    const fixture = await startBridgeFixture((request, response) => {
      authorizations.push(request.headers.authorization);
      if (request.url === '/redirected') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ product: 'redirect-target' }));
        return;
      }
      response.statusCode = 302;
      response.setHeader('location', '/redirected');
      response.end();
    });
    const databaseDirectory = await temporaryDirectory('workspace-redirect-');
    const app = await createWorkspaceServer({
      workspaceToken: TOKEN,
      bridgeToken: BRIDGE_TOKEN,
      bridgeUrl: fixture.url,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
    });

    try {
      const result = await app.inject({
        method: 'GET',
        url: '/project/memory',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(result.statusCode).toBe(502);
      expect(authorizations).toEqual([undefined]);
    } finally {
      await app.close();
      await fixture.close();
    }
  });
});
