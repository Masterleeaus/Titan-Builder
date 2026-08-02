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
  resolveProjectPath,
  loadCompanionEnvironment,
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

describe('companion environment loading', () => {
  it('loads from OPENBROWSER_CONFIG when set', async () => {
    const root = await temporaryDirectory('companion-env-');
    const configPath = path.join(root, 'custom.env');
    await fs.writeFile(configPath, 'TEST_VAR=custom_value\n');

    const savedEnv = process.env.OPENBROWSER_CONFIG;
    try {
      process.env.OPENBROWSER_CONFIG = configPath;
      const result = loadCompanionEnvironment({ homeDir: root, packageRoot: root });
      expect(result).toBe(configPath);
      expect(process.env.TEST_VAR).toBe('custom_value');
    } finally {
      process.env.OPENBROWSER_CONFIG = savedEnv;
      delete process.env.TEST_VAR;
    }
  });

  it('loads from ~/.openbrowser/.env as fallback', async () => {
    const homeDir = await temporaryDirectory('companion-home-');
    const packageRoot = await temporaryDirectory('companion-package-');
    const configPath = path.join(homeDir, '.openbrowser', '.env');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, 'TEST_HOME=home_value\n');

    const savedEnv = process.env.OPENBROWSER_CONFIG;
    try {
      delete process.env.OPENBROWSER_CONFIG;
      const result = loadCompanionEnvironment({ homeDir, packageRoot });
      expect(result).toBe(configPath);
      expect(process.env.TEST_HOME).toBe('home_value');
    } finally {
      process.env.OPENBROWSER_CONFIG = savedEnv;
      delete process.env.TEST_HOME;
    }
  });

  it('loads from package root .env as final fallback', async () => {
    const homeDir = await temporaryDirectory('companion-home-');
    const packageRoot = await temporaryDirectory('companion-package-');
    const configPath = path.join(packageRoot, '.env');
    await fs.writeFile(configPath, 'TEST_PACKAGE=package_value\n');

    const savedEnv = process.env.OPENBROWSER_CONFIG;
    try {
      delete process.env.OPENBROWSER_CONFIG;
      const result = loadCompanionEnvironment({ homeDir, packageRoot });
      expect(result).toBe(configPath);
      expect(process.env.TEST_PACKAGE).toBe('package_value');
    } finally {
      process.env.OPENBROWSER_CONFIG = savedEnv;
      delete process.env.TEST_PACKAGE;
    }
  });

  it('never loads from current working directory', async () => {
    const cwd = await temporaryDirectory('companion-cwd-');
    const homeDir = await temporaryDirectory('companion-home-');
    const packageRoot = await temporaryDirectory('companion-package-');
    const cwdEnvPath = path.join(cwd, '.env');
    await fs.writeFile(cwdEnvPath, 'CWD_SECRET=exposed\n');

    const savedEnv = process.env.OPENBROWSER_CONFIG;
    const savedCwd = process.cwd();
    try {
      delete process.env.OPENBROWSER_CONFIG;
      process.chdir(cwd);
      const result = loadCompanionEnvironment({ homeDir, packageRoot });
      expect(result).toBeUndefined();
      expect(process.env.CWD_SECRET).toBeUndefined();
    } finally {
      process.chdir(savedCwd);
      process.env.OPENBROWSER_CONFIG = savedEnv;
    }
  });

  it('only sets env vars that are not already defined', async () => {
    const root = await temporaryDirectory('companion-override-');
    const configPath = path.join(root, 'test.env');
    await fs.writeFile(configPath, 'EXISTING_VAR=file_value\nNEW_VAR=new_value\n');

    const savedEnv = process.env.OPENBROWSER_CONFIG;
    try {
      process.env.OPENBROWSER_CONFIG = configPath;
      process.env.EXISTING_VAR = 'process_value';
      loadCompanionEnvironment({ homeDir: root, packageRoot: root });
      expect(process.env.EXISTING_VAR).toBe('process_value');
      expect(process.env.NEW_VAR).toBe('new_value');
    } finally {
      process.env.OPENBROWSER_CONFIG = savedEnv;
      delete process.env.EXISTING_VAR;
      delete process.env.NEW_VAR;
    }
  });

  it('returns undefined when no config file is found', async () => {
    const homeDir = await temporaryDirectory('companion-empty-home-');
    const packageRoot = await temporaryDirectory('companion-empty-package-');

    const savedEnv = process.env.OPENBROWSER_CONFIG;
    try {
      delete process.env.OPENBROWSER_CONFIG;
      const result = loadCompanionEnvironment({ homeDir, packageRoot });
      expect(result).toBeUndefined();
    } finally {
      process.env.OPENBROWSER_CONFIG = savedEnv;
    }
  });
});
