import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeOperations, planOperations } from './index.ts';

const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
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
