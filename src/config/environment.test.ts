import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  loadOpenBrowserEnvironment,
  parseEnvironmentText,
} from './environment.ts';

test('parses quoted values, comments, and equals signs', () => {
  assert.deepEqual(
    parseEnvironmentText(`
# comment
PORT=5100
BRIDGE_TOKEN="alpha=beta"
OPENBROWSER_ALLOW_UNSAFE_COMMANDS='0'
EMPTY=
`),
    {
      PORT: '5100',
      BRIDGE_TOKEN: 'alpha=beta',
      OPENBROWSER_ALLOW_UNSAFE_COMMANDS: '0',
      EMPTY: '',
    },
  );
});

test('loads user-level config without reading the current project env file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-env-'));
  const homeDir = path.join(root, 'home');
  const packageRoot = path.join(root, 'package');
  const projectRoot = path.join(root, 'target-project');
  await mkdir(path.join(homeDir, '.openbrowser'), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await mkdir(projectRoot, { recursive: true });

  await writeFile(path.join(homeDir, '.openbrowser', '.env'), 'PORT=5101\nBRIDGE_TOKEN=user-token\n');
  await writeFile(path.join(packageRoot, '.env'), 'PORT=5102\nBRIDGE_TOKEN=package-token\n');
  await writeFile(path.join(projectRoot, '.env'), 'PORT=9999\nBRIDGE_TOKEN=project-secret\n');

  const env: NodeJS.ProcessEnv = {};
  const loadedPath = loadOpenBrowserEnvironment({
    env,
    homeDir,
    packageRoot,
  });

  assert.equal(loadedPath, path.join(homeDir, '.openbrowser', '.env'));
  assert.equal(env.PORT, '5101');
  assert.equal(env.BRIDGE_TOKEN, 'user-token');
  assert.notEqual(env.BRIDGE_TOKEN, 'project-secret');
});

test('explicit config path wins and existing process values are preserved', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-env-explicit-'));
  const explicitPath = path.join(root, 'custom.env');
  await writeFile(explicitPath, 'PORT=5200\nBRIDGE_TOKEN=file-token\n');

  const env: NodeJS.ProcessEnv = {
    OPENBROWSER_CONFIG: explicitPath,
    PORT: '5300',
  };

  const loadedPath = loadOpenBrowserEnvironment({
    env,
    homeDir: path.join(root, 'home'),
    packageRoot: path.join(root, 'package'),
  });

  assert.equal(loadedPath, explicitPath);
  assert.equal(env.PORT, '5300');
  assert.equal(env.BRIDGE_TOKEN, 'file-token');
});
