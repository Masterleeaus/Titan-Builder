import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspaceEnvironment } from './environment.js';

const execFileAsync = promisify(execFile);
const moduleRequire = createRequire(import.meta.url);
const temporaryDirectories: string[] = [];
const originalCwd = process.cwd();

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('workspace companion environment authority', () => {
  it('does not load a malicious target-project .env from the launch directory', async () => {
    const projectRoot = await temporaryDirectory('workspace-project-env-');
    const homeDir = await temporaryDirectory('workspace-home-env-');
    const packageRoot = await temporaryDirectory('workspace-package-env-');
    const userConfigDirectory = path.join(homeDir, '.openbrowser');
    const userConfigPath = path.join(userConfigDirectory, '.env');

    await fs.mkdir(userConfigDirectory, { recursive: true });
    await fs.writeFile(path.join(projectRoot, '.env'), [
      'BRIDGE_TOKEN=project-secret',
      'WORKSPACE_PORT=65535',
      'TARGET_PROJECT_ONLY=poisoned',
    ].join('\n'));
    await fs.writeFile(userConfigPath, [
      'BRIDGE_TOKEN=user-scoped-token',
      'WORKSPACE_PORT=5010',
    ].join('\n'));

    process.chdir(projectRoot);
    const env: NodeJS.ProcessEnv = {};
    const loadedPath = loadWorkspaceEnvironment({ env, homeDir, packageRoot });

    expect(loadedPath).toBe(userConfigPath);
    expect(env.BRIDGE_TOKEN).toBe('user-scoped-token');
    expect(env.WORKSPACE_PORT).toBe('5010');
    expect(env.TARGET_PROJECT_ONLY).toBeUndefined();
  });

  it('boots the production entrypoint without importing a poisoned cwd .env', async () => {
    const projectRoot = await temporaryDirectory('workspace-entrypoint-project-');
    const explicitDirectory = await temporaryDirectory('workspace-entrypoint-config-');
    const explicitPath = path.join(explicitDirectory, 'companion.env');

    await fs.writeFile(path.join(projectRoot, '.env'), [
      'BRIDGE_TOKEN=project-secret',
      'WORKSPACE_PORT=65535',
      'TARGET_PROJECT_ONLY=poisoned',
    ].join('\n'));
    await fs.writeFile(explicitPath, [
      'BRIDGE_TOKEN=explicit-token',
      'WORKSPACE_PORT=5010',
    ].join('\n'));

    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      OPENBROWSER_CONFIG: explicitPath,
    };
    delete childEnvironment.BRIDGE_TOKEN;
    delete childEnvironment.WORKSPACE_PORT;
    delete childEnvironment.TARGET_PROJECT_ONLY;

    const entrypointUrl = pathToFileURL(path.join(originalCwd, 'bridge-server-entry.ts')).href;
    const tsxLoaderUrl = pathToFileURL(moduleRequire.resolve('tsx')).href;
    const probe = [
      `await import(${JSON.stringify(entrypointUrl)});`,
      'process.stdout.write(JSON.stringify({',
      '  bridgeToken: process.env.BRIDGE_TOKEN,',
      '  workspacePort: process.env.WORKSPACE_PORT,',
      '  targetProjectOnly: process.env.TARGET_PROJECT_ONLY ?? null,',
      '}));',
    ].join('\n');

    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      tsxLoaderUrl,
      '--input-type=module',
      '--eval',
      probe,
    ], {
      cwd: projectRoot,
      env: childEnvironment,
      timeout: 20_000,
    });

    expect(JSON.parse(stdout)).toEqual({
      bridgeToken: 'explicit-token',
      workspacePort: '5010',
      targetProjectOnly: null,
    });
  });

  it('prefers OPENBROWSER_CONFIG and preserves existing process values', async () => {
    const homeDir = await temporaryDirectory('workspace-home-precedence-');
    const packageRoot = await temporaryDirectory('workspace-package-precedence-');
    const explicitPath = path.join(await temporaryDirectory('workspace-explicit-env-'), 'companion.env');

    await fs.mkdir(path.join(homeDir, '.openbrowser'), { recursive: true });
    await fs.writeFile(path.join(homeDir, '.openbrowser', '.env'), 'WORKSPACE_PORT=5011\n');
    await fs.writeFile(path.join(packageRoot, '.env'), 'WORKSPACE_PORT=5012\n');
    await fs.writeFile(explicitPath, 'WORKSPACE_PORT=5013\nBRIDGE_TOKEN=explicit-token\n');

    const env: NodeJS.ProcessEnv = {
      OPENBROWSER_CONFIG: explicitPath,
      WORKSPACE_PORT: '6000',
    };
    const loadedPath = loadWorkspaceEnvironment({ env, homeDir, packageRoot });

    expect(loadedPath).toBe(explicitPath);
    expect(env.WORKSPACE_PORT).toBe('6000');
    expect(env.BRIDGE_TOKEN).toBe('explicit-token');
  });

  it('returns no configuration instead of falling back to cwd discovery', async () => {
    const projectRoot = await temporaryDirectory('workspace-project-only-env-');
    const homeDir = await temporaryDirectory('workspace-empty-home-');
    const packageRoot = await temporaryDirectory('workspace-empty-package-');
    await fs.writeFile(path.join(projectRoot, '.env'), 'WORKSPACE_TOKEN=project-token\n');

    process.chdir(projectRoot);
    const env: NodeJS.ProcessEnv = {};

    expect(loadWorkspaceEnvironment({ env, homeDir, packageRoot })).toBeUndefined();
    expect(env.WORKSPACE_TOKEN).toBeUndefined();
  });
});
