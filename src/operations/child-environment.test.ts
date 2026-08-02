import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildRepositoryChildEnvironment,
  formatEnvironmentGrantPreview,
  redactChildOutput,
  validateEnvironmentGrants,
} from './child-environment.ts';
import { executeOperations, planOperations } from './index.ts';

const sourceEnvironment: NodeJS.ProcessEnv = {
  PATH: '/usr/local/bin:/usr/bin',
  HOME: '/home/operator',
  TEMP: '/tmp',
  LANG: 'en_AU.UTF-8',
  LC_ALL: 'en_AU.UTF-8',
  CI: 'true',
  CUSTOM_BUILD_FLAG: 'enabled',
  HTTP_PROXY: 'http://proxy.example:8080',
  BRIDGE_TOKEN: 'bridge-secret-value',
  BRIDGE_BROWSER_TOKEN: 'browser-secret-value',
  OPENAI_API_KEY: 'provider-secret-value',
  GITHUB_TOKEN: 'github-secret-value',
  UNRELATED_PASSWORD: 'unrelated-secret-value',
  NODE_OPTIONS: '--require /tmp/host-hook.cjs',
};

const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

test('repository children receive only the baseline runtime allowlist by default', () => {
  const result = buildRepositoryChildEnvironment(sourceEnvironment);

  assert.deepEqual(result.env, {
    PATH: '/usr/local/bin:/usr/bin',
    HOME: '/home/operator',
    TEMP: '/tmp',
    LANG: 'en_AU.UTF-8',
    LC_ALL: 'en_AU.UTF-8',
    CI: 'true',
  });
  assert.equal(result.env.BRIDGE_TOKEN, undefined);
  assert.equal(result.env.BRIDGE_BROWSER_TOKEN, undefined);
  assert.equal(result.env.OPENAI_API_KEY, undefined);
  assert.equal(result.env.GITHUB_TOKEN, undefined);
  assert.equal(result.env.UNRELATED_PASSWORD, undefined);
  assert.equal(result.env.NODE_OPTIONS, undefined);
  assert.equal(result.env.CUSTOM_BUILD_FLAG, undefined);
  assert.equal(result.env.HTTP_PROXY, undefined);
});

test('explicit non-sensitive grants are canonical, deterministic, and value-redacted', () => {
  const grants = validateEnvironmentGrants(['http_proxy', 'CUSTOM_BUILD_FLAG', 'HTTP_PROXY']);
  const result = buildRepositoryChildEnvironment(sourceEnvironment, grants);

  assert.deepEqual(grants, ['CUSTOM_BUILD_FLAG', 'HTTP_PROXY']);
  assert.equal(result.env.CUSTOM_BUILD_FLAG, 'enabled');
  assert.equal(result.env.HTTP_PROXY, 'http://proxy.example:8080');
  assert.equal(formatEnvironmentGrantPreview(grants), 'CUSTOM_BUILD_FLAG, HTTP_PROXY');

  const redacted = redactChildOutput(
    'flag=enabled proxy=http://proxy.example:8080',
    result.redactions,
  );
  assert.equal(redacted.includes('enabled'), false);
  assert.equal(redacted.includes('http://proxy.example:8080'), false);
  assert.equal(redacted, 'flag=[REDACTED] proxy=[REDACTED]');
});

test('secret-bearing and process-injection variables cannot be granted', () => {
  for (const name of [
    'BRIDGE_TOKEN',
    'bridge_browser_token',
    'OPENAI_API_KEY',
    'GITHUB_TOKEN',
    'UNRELATED_PASSWORD',
    'NODE_OPTIONS',
    'NODE_PATH',
    'LD_PRELOAD',
    'DYLD_INSERT_LIBRARIES',
    'BASH_ENV',
    'npm_config_//registry.npmjs.org/:_authToken',
  ]) {
    assert.throws(
      () => validateEnvironmentGrants([name]),
      new RegExp(`Environment variable .*${escapeForRegExp(name)}.* cannot be granted`, 'i'),
    );
  }
});

test('removed credential values are redacted from child output and diagnostics', () => {
  const result = buildRepositoryChildEnvironment(sourceEnvironment);
  const output = [
    'bridge=bridge-secret-value',
    'browser=browser-secret-value',
    'provider=provider-secret-value',
    'github=github-secret-value',
    'password=unrelated-secret-value',
    'path=/usr/local/bin:/usr/bin',
  ].join('\n');

  const redacted = redactChildOutput(output, result.redactions);
  assert.equal(redacted.includes('bridge-secret-value'), false);
  assert.equal(redacted.includes('browser-secret-value'), false);
  assert.equal(redacted.includes('provider-secret-value'), false);
  assert.equal(redacted.includes('github-secret-value'), false);
  assert.equal(redacted.includes('unrelated-secret-value'), false);
  assert.equal(redacted.includes('/usr/local/bin:/usr/bin'), true);
  assert.match(redacted, /bridge=\[REDACTED\]/);
});

test('environment grant validation rejects malformed names and remains bounded', () => {
  assert.throws(() => validateEnvironmentGrants(['']), /valid environment variable name/i);
  assert.throws(() => validateEnvironmentGrants(['NOT-AN-ENV-NAME']), /valid environment variable name/i);
  assert.throws(
    () => validateEnvironmentGrants(Array.from({ length: 33 }, (_, index) => `SAFE_${index}`)),
    /at most 32 environment variable grants/i,
  );
});

test('planned operations bind normalized grant names into the approval preview', async () => {
  const projectRoot = await temporaryDirectory('openbrowser-env-plan-');
  const [plan] = await planOperations([
    {
      action: 'RUN_TOOL',
      tool: 'node.version',
      env: ['http_proxy', 'CUSTOM_BUILD_FLAG', 'HTTP_PROXY'],
    },
  ], projectRoot);

  assert.deepEqual(plan?.operation.env, ['CUSTOM_BUILD_FLAG', 'HTTP_PROXY']);
  assert.match(plan?.diff ?? '', /ENVIRONMENT: CUSTOM_BUILD_FLAG, HTTP_PROXY/u);

  await assert.rejects(
    () => planOperations([
      { action: 'RUN_TOOL', tool: 'node.version', env: ['BRIDGE_TOKEN'] },
    ], projectRoot),
    /BRIDGE_TOKEN cannot be granted/i,
  );

  await assert.rejects(
    () => planOperations([
      { action: 'CREATE_FILE', path: 'note.txt', content: 'hello', env: ['CUSTOM_BUILD_FLAG'] },
    ], projectRoot),
    /CREATE_FILE cannot request environment variable grants/i,
  );
});

test('npm, pnpm, direct tools, and legacy commands receive sanitized environments', async () => {
  const projectRoot = await temporaryDirectory('openbrowser-env-execution-');
  const bridgeSecret = 'bridge-secret-integration-111';
  const providerSecret = 'provider-secret-integration-111';
  const script = [
    "console.log(JSON.stringify({",
    "  bridge: process.env.BRIDGE_TOKEN ?? null,",
    "  provider: process.env.OPENAI_API_KEY ?? null,",
    "  customPresent: process.env.CUSTOM_BUILD_FLAG === 'approved-value',",
    `  literal: ${JSON.stringify(bridgeSecret)},`,
    '}));',
  ].join('\n');
  await writeFile(path.join(projectRoot, 'inspect-env.mjs'), script, 'utf8');
  await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'child-environment-fixture',
    private: true,
    scripts: {
      test: 'node inspect-env.mjs',
      build: 'node inspect-env.mjs',
    },
  }, null, 2), 'utf8');

  const previous = captureEnvironment([
    'BRIDGE_TOKEN',
    'OPENAI_API_KEY',
    'CUSTOM_BUILD_FLAG',
    'OPENBROWSER_ALLOW_UNSAFE_COMMANDS',
  ]);
  process.env.BRIDGE_TOKEN = bridgeSecret;
  process.env.OPENAI_API_KEY = providerSecret;
  process.env.CUSTOM_BUILD_FLAG = 'approved-value';
  process.env.OPENBROWSER_ALLOW_UNSAFE_COMMANDS = '1';

  const output = await captureOutput(async () => {
    await executeOperations([
      {
        action: 'RUN_TOOL',
        tool: 'npm.run',
        args: ['test'],
        env: ['CUSTOM_BUILD_FLAG'],
      },
    ], projectRoot);
    await executeOperations([
      {
        action: 'RUN_TOOL',
        tool: 'pnpm.run',
        args: ['build'],
      },
    ], projectRoot);
    await executeOperations([
      {
        action: 'RUN_TOOL',
        tool: 'node.version',
      },
    ], projectRoot);
    await executeOperations([
      {
        action: 'RUN_COMMAND',
        command: `${quoteShellArgument(process.execPath)} inspect-env.mjs`,
      },
    ], projectRoot);
  }).finally(() => restoreEnvironment(previous));

  assert.equal(output.includes(bridgeSecret), false);
  assert.equal(output.includes(providerSecret), false);
  assert.equal(output.includes('approved-value'), false);
  assert.match(output, /\[REDACTED\]/u);
  assert.match(output, /"bridge":null/u);
  assert.match(output, /"provider":null/u);
  assert.match(output, /"customPresent":true/u);
  assert.match(output, /"customPresent":false/u);
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function captureOutput(run: () => Promise<void>): Promise<string> {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let output = '';
  const capture = ((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = capture;
  process.stderr.write = capture;
  try {
    await run();
    return output;
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

function captureEnvironment(names: readonly string[]): Map<string, string | undefined> {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(previous: ReadonlyMap<string, string | undefined>): void {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function quoteShellArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
