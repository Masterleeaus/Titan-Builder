import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRipgrepArguments,
  createWorkspaceServer,
  createZipBuffer,
  normalizeExportName,
  normalizeRelativePath,
  normalizeWorkspaceError,
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

describe('workspace error normalization', () => {
  it('preserves validated HTTP errors and Error diagnostics', () => {
    expect(normalizeWorkspaceError(Object.assign(new Error('Conflict'), { statusCode: 409 })))
      .toEqual({ statusCode: 409, message: 'Conflict' });
    expect(normalizeWorkspaceError(new Error('Database unavailable')))
      .toEqual({ statusCode: 500, message: 'Database unavailable' });
  });

  it('rejects invalid status values and non-Error diagnostics', () => {
    expect(normalizeWorkspaceError({ statusCode: 200, message: 'not an error' }))
      .toEqual({ statusCode: 500, message: 'Unknown workspace error' });
    expect(normalizeWorkspaceError({ statusCode: '404', message: 'wrong type' }))
      .toEqual({ statusCode: 500, message: 'Unknown workspace error' });
    expect(normalizeWorkspaceError('raw secret value'))
      .toEqual({ statusCode: 500, message: 'Unknown workspace error' });
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


describe('authenticated bridge forwarding', () => {
  it('proves bridge identity before attaching the control token', async () => {
    const databaseDirectory = await temporaryDirectory('workspace-auth-db-');
    const bridgeToken = 'bridge-test-token-12345678901234567890';
    const instanceId = '12345678-1234-4234-8234-123456789abc';
    const bridgeFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/bridge/identity') {
        expect(init?.headers).toBeUndefined();
        expect(init?.redirect).toBe('manual');
        const nonce = url.searchParams.get('nonce') ?? '';
        const unsigned = {
          protocol: 'openbrowser-bridge',
          version: '1',
          instanceId,
          nonce,
          address: '127.0.0.1',
          port: 51234,
        };
        return new Response(JSON.stringify({
          ...unsigned,
          mac: crypto.createHmac('sha256', bridgeToken).update(JSON.stringify([
            unsigned.protocol,
            unsigned.version,
            unsigned.instanceId,
            unsigned.nonce,
            unsigned.address,
            unsigned.port,
          ])).digest('hex'),
        }), { status: 200 });
      }

      expect(url.pathname).toBe('/session/prompt');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${bridgeToken}`);
      expect(init?.redirect).toBe('manual');
      return new Response(JSON.stringify({ sessionId: 'session-1', status: 'pending' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const app = await createWorkspaceServer({
      workspaceToken: TOKEN,
      databasePath: path.join(databaseDirectory, 'workspace.db'),
      bridgeToken,
      bridgeUrl: 'http://127.0.0.1:51234',
      bridgeAllowedPorts: [51234],
      bridgeFetch,
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/prompt',
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { prompt: 'Inspect the project', mode: 'ask' },
      });
      expect(response.statusCode).toBe(200);
      expect(bridgeFetch).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
});
