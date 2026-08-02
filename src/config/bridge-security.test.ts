import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureBridgeSecurityEnvironment } from './bridge-security.ts';

const STRONG_CONTROL = 'control-'.padEnd(56, 'a');

test('creates distinct strong control and browser tokens in the user config when absent', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-security-'));
  const env: NodeJS.ProcessEnv = {};
  try {
    const result = await ensureBridgeSecurityEnvironment({ env, homeDir });
    assert.equal(result.generatedControlToken, true);
    assert.equal(result.generatedBrowserToken, true);
    assert.ok((env.BRIDGE_TOKEN?.length ?? 0) >= 32);
    assert.ok((env.BRIDGE_BROWSER_TOKEN?.length ?? 0) >= 32);
    assert.notEqual(env.BRIDGE_TOKEN, env.BRIDGE_BROWSER_TOKEN);

    const content = await readFile(result.configPath, 'utf8');
    assert.match(content, /^BRIDGE_TOKEN=.+$/m);
    assert.match(content, /^BRIDGE_BROWSER_TOKEN=.+$/m);
    if (process.platform !== 'win32') {
      const mode = (await stat(result.configPath)).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('preserves an existing strong control token and appends only the missing browser token', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-security-'));
  const configPath = path.join(homeDir, '.openbrowser', '.env');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `PORT=5100\nBRIDGE_TOKEN=${STRONG_CONTROL}\n`, 'utf8');
  const env: NodeJS.ProcessEnv = {};

  try {
    const result = await ensureBridgeSecurityEnvironment({ env, homeDir });
    assert.equal(result.generatedControlToken, false);
    assert.equal(result.generatedBrowserToken, true);
    assert.equal(env.BRIDGE_TOKEN, STRONG_CONTROL);
    assert.notEqual(env.BRIDGE_BROWSER_TOKEN, STRONG_CONTROL);
    const content = await readFile(configPath, 'utf8');
    assert.equal((content.match(/^BRIDGE_TOKEN=/gm) ?? []).length, 1);
    assert.equal((content.match(/^BRIDGE_BROWSER_TOKEN=/gm) ?? []).length, 1);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('rejects weak configured tokens instead of silently starting an insecure bridge', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-security-'));
  try {
    await assert.rejects(
      ensureBridgeSecurityEnvironment({
        env: {
          BRIDGE_TOKEN: 'weak',
          BRIDGE_BROWSER_TOKEN: 'also-weak',
        },
        homeDir,
      }),
      /at least 32 characters/i,
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('explicit insecure development mode is the only missing-token bypass', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-security-'));
  const env: NodeJS.ProcessEnv = { OPENBROWSER_INSECURE_DEV: '1' };
  try {
    const result = await ensureBridgeSecurityEnvironment({ env, homeDir });
    assert.equal(result.insecureDevelopment, true);
    assert.equal(result.generatedControlToken, false);
    assert.equal(result.generatedBrowserToken, false);
    await assert.rejects(access(result.configPath));
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
