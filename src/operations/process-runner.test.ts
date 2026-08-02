import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import {
  ContainedProcessError,
  runContainedProcess,
} from './process-runner.ts';

const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

test('successful commands preserve stdout and stderr', async () => {
  const result = await runContainedProcess({
    executable: process.execPath,
    args: ['-e', 'process.stdout.write("ok"); process.stderr.write("warning")'],
    cwd: process.cwd(),
    toolId: 'fixture.success',
    timeoutMs: 5_000,
    maxOutputBytes: 64 * 1024,
    terminationGraceMs: 250,
  });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'ok');
  assert.equal(result.stderr, 'warning');
});

test('spawn and non-zero exit failures settle with structured diagnostics', async () => {
  await assert.rejects(
    runContainedProcess({
      executable: `openbrowser-missing-command-${process.pid}`,
      args: [],
      cwd: process.cwd(),
      toolId: 'fixture.missing',
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ContainedProcessError);
      assert.equal(error.details.kind, 'spawn');
      return true;
    },
  );

  await assert.rejects(
    runContainedProcess({
      executable: process.execPath,
      args: ['-e', 'process.exit(7)'],
      cwd: process.cwd(),
      toolId: 'fixture.exit',
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ContainedProcessError);
      assert.equal(error.details.kind, 'exit');
      assert.equal(error.details.code, 7);
      return true;
    },
  );
});

test('timeout terminates a long-running grandchild and releases its port', async () => {
  const fixture = await createTreeFixture('timeout');

  await assert.rejects(
    runContainedProcess({
      executable: process.execPath,
      args: [fixture.scriptPath, fixture.readyPath, String(fixture.port), 'timeout'],
      cwd: fixture.directory,
      toolId: 'fixture.timeout',
      timeoutMs: 1_200,
      maxOutputBytes: 64 * 1024,
      terminationGraceMs: 400,
    }),
    (error: unknown) => assertTerminatedFailure(error, 'timeout'),
  );

  const grandchildPid = await readReadyPid(fixture.readyPath);
  assert.equal(await waitForPidExit(grandchildPid), true);
  assert.equal(await waitForPortRelease(fixture.port), true);
});

test('output overflow terminates a long-running grandchild and releases its port', async () => {
  const fixture = await createTreeFixture('overflow');

  await assert.rejects(
    runContainedProcess({
      executable: process.execPath,
      args: [fixture.scriptPath, fixture.readyPath, String(fixture.port), 'overflow'],
      cwd: fixture.directory,
      toolId: 'fixture.overflow',
      timeoutMs: 10_000,
      maxOutputBytes: 32 * 1024,
      terminationGraceMs: 400,
    }),
    (error: unknown) => assertTerminatedFailure(error, 'output_limit'),
  );

  const grandchildPid = await readReadyPid(fixture.readyPath);
  assert.equal(await waitForPidExit(grandchildPid), true);
  assert.equal(await waitForPortRelease(fixture.port), true);
});

function assertTerminatedFailure(
  error: unknown,
  kind: 'timeout' | 'output_limit',
): boolean {
  assert.ok(error instanceof ContainedProcessError);
  assert.equal(error.details.kind, kind);
  assert.equal(error.details.termination?.confirmed, true);
  assert.deepEqual(error.details.termination?.residualPids, []);
  assert.match(error.message, /process tree/i);
  return true;
}

async function createTreeFixture(mode: string): Promise<{
  directory: string;
  scriptPath: string;
  readyPath: string;
  port: number;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `openbrowser-tree-${mode}-`));
  temporaryDirectories.push(directory);
  const scriptPath = path.join(directory, 'parent.cjs');
  const readyPath = path.join(directory, 'grandchild.ready');
  const port = await allocatePort();

  const grandchildSource = [
    "const fs = require('node:fs');",
    "const net = require('node:net');",
    'const [readyPath, portText] = process.argv.slice(1);',
    'const server = net.createServer();',
    "server.listen(Number(portText), '127.0.0.1', () => {",
    '  fs.writeFileSync(readyPath, String(process.pid));',
    "  if (process.send) process.send('ready');",
    '});',
    "process.on('SIGTERM', () => {",
    '  server.close(() => process.exit(0));',
    '  setTimeout(() => process.exit(1), 100).unref();',
    '});',
    'setInterval(() => undefined, 1000);',
  ].join('\n');

  const parentSource = [
    "const { spawn } = require('node:child_process');",
    'const [readyPath, portText, mode] = process.argv.slice(2);',
    `const grandchildSource = ${JSON.stringify(grandchildSource)};`,
    'const grandchild = spawn(process.execPath, [\'-e\', grandchildSource, readyPath, portText], {',
    "  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],",
    '});',
    "grandchild.once('message', () => {",
    "  if (mode !== 'overflow') return;",
    "  const chunk = 'x'.repeat(8192);",
    '  const flood = () => {',
    '    while (process.stdout.write(chunk)) { /* fill until backpressure */ }',
    "    process.stdout.once('drain', flood);",
    '  };',
    '  flood();',
    '});',
    'setInterval(() => undefined, 1000);',
  ].join('\n');

  await writeFile(scriptPath, parentSource, 'utf8');
  return { directory, scriptPath, readyPath, port };
}

async function allocatePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

async function readReadyPid(readyPath: string): Promise<number> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await access(readyPath);
      const pid = Number((await readFile(readyPath, 'utf8')).trim());
      assert.ok(Number.isInteger(pid) && pid > 0);
      return pid;
    } catch {
      await delay(25);
    }
  }
  throw new Error(`Grandchild did not become ready: ${readyPath}`);
}

async function waitForPidExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await delay(25);
  }
  return !isPidAlive(pid);
}

async function waitForPortRelease(port: number): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await canListen(port)) return true;
    await delay(25);
  }
  return canListen(port);
}

async function canListen(port: number): Promise<boolean> {
  const server = net.createServer();
  return new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
