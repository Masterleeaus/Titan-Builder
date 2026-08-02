import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

describe('workspace error normalization', () => {
  it('fails closed for arbitrary thrown values without exposing them', () => {
    expect(normalizeWorkspaceError('secret diagnostic')).toEqual({
      statusCode: 500,
      error: 'Workspace operation failed',
    });
    expect(normalizeWorkspaceError({ statusCode: 418, message: 'object secret' })).toEqual({
      statusCode: 500,
      error: 'Workspace operation failed',
    });
  });

  it('preserves Error diagnostics only as server detail', () => {
    expect(normalizeWorkspaceError(new Error('database unavailable'))).toEqual({
      statusCode: 500,
      error: 'Workspace operation failed',
      detail: 'database unavailable',
    });
  });

  it('accepts only valid HTTP status codes attached to Error instances', () => {
    const notFound = Object.assign(new Error('Project not found'), { statusCode: 404 });
    expect(normalizeWorkspaceError(notFound)).toEqual({
      statusCode: 404,
      error: 'Project not found',
    });

    const invalidStatus = Object.assign(new Error('invalid status'), { statusCode: 200 });
    expect(normalizeWorkspaceError(invalidStatus)).toEqual({
      statusCode: 500,
      error: 'Workspace operation failed',
      detail: 'invalid status',
    });
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
