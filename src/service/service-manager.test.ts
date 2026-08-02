import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createServiceManager,
  getServicePaths,
} from './service-manager.ts';

async function fixtureHome(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'openbrowser-service-'));
}

test('service manager starts once, verifies health, tails logs, and stops', async () => {
  const homeDir = await fixtureHome();
  const running = new Set<number>();
  const spawned: unknown[] = [];
  const signals: string[] = [];
  let unrefCount = 0;
  const manager = createServiceManager({
    homeDir,
    entryPath: '/opt/openbrowser/service-entry.js',
    spawnProcess: (command, args, options) => {
      spawned.push({ command, args, options });
      running.add(4321);
      return { pid: 4321, unref: () => { unrefCount += 1; } };
    },
    isProcessRunning: (pid) => running.has(pid),
    terminateProcess: (pid, signal) => {
      signals.push(signal);
      running.delete(pid);
    },
    probeBridge: async () => running.has(4321),
    sleep: async () => undefined,
  });

  const started = await manager.start();
  assert.equal(started.status, 'running');
  assert.equal(started.healthy, true);
  assert.equal(started.pid, 4321);
  assert.equal(spawned.length, 1);
  assert.equal(unrefCount, 1);

  const second = await manager.start();
  assert.equal(second.alreadyRunning, true);
  assert.equal(spawned.length, 1);

  const paths = getServicePaths({ homeDir });
  const metadata = JSON.parse(await readFile(paths.metadataPath, 'utf8'));
  assert.equal(metadata.pid, 4321);
  assert.equal(metadata.entryPath, '/opt/openbrowser/service-entry.js');

  await writeFile(paths.logPath, 'one\ntwo\nthree\n', 'utf8');
  assert.equal(await manager.logs(2), 'two\nthree');

  const stopped = await manager.stop();
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal((await manager.status()).status, 'stopped');
});

test('service manager replaces stale metadata instead of trusting a dead pid', async () => {
  const homeDir = await fixtureHome();
  const paths = getServicePaths({ homeDir });
  const setup = createServiceManager({ homeDir, probeBridge: async () => false });
  await setup.ensureDirectories();
  await writeFile(paths.metadataPath, JSON.stringify({
    version: 1,
    pid: 9999,
    entryPath: '/old/service.js',
    startedAt: '2026-01-01T00:00:00.000Z',
    logPath: paths.logPath,
  }), 'utf8');

  let spawned = 0;
  const manager = createServiceManager({
    homeDir,
    entryPath: '/new/service.js',
    spawnProcess: () => {
      spawned += 1;
      return { pid: 7777, unref: () => undefined };
    },
    isProcessRunning: (pid) => pid === 7777,
    terminateProcess: () => undefined,
    probeBridge: async () => spawned > 0,
    sleep: async () => undefined,
  });

  const result = await manager.start();
  assert.equal(result.pid, 7777);
  assert.equal(spawned, 1);
  assert.equal(JSON.parse(await readFile(paths.metadataPath, 'utf8')).entryPath, '/new/service.js');
});

test('service refuses to start when an unmanaged bridge already owns the health endpoint', async () => {
  const homeDir = await fixtureHome();
  let spawned = false;
  const manager = createServiceManager({
    homeDir,
    probeBridge: async () => true,
    spawnProcess: () => {
      spawned = true;
      return { pid: 1234, unref: () => undefined };
    },
  });

  await assert.rejects(() => manager.start(), /already responding|not managed/i);
  assert.equal(spawned, false);
});

test('failed startup health check terminates the child and removes metadata', async () => {
  const homeDir = await fixtureHome();
  const running = new Set([2468]);
  const signals: string[] = [];
  const manager = createServiceManager({
    homeDir,
    spawnProcess: () => ({ pid: 2468, unref: () => undefined }),
    isProcessRunning: (pid) => running.has(pid),
    terminateProcess: (pid, signal) => {
      signals.push(signal);
      running.delete(pid);
    },
    probeBridge: async () => false,
    startupTimeoutMs: 2,
    sleep: async () => undefined,
  });

  await assert.rejects(() => manager.start(), /health check/i);
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal((await manager.status()).status, 'stopped');
});

test('service rotates an oversized log before spawning', async () => {
  const homeDir = await fixtureHome();
  const paths = getServicePaths({ homeDir });
  const setup = createServiceManager({ homeDir, probeBridge: async () => false });
  await setup.ensureDirectories();
  await writeFile(paths.logPath, '0123456789abcdef', 'utf8');
  let spawned = false;
  const manager = createServiceManager({
    homeDir,
    maxLogBytes: 8,
    spawnProcess: () => {
      spawned = true;
      return { pid: 1357, unref: () => undefined };
    },
    isProcessRunning: (pid) => pid === 1357,
    terminateProcess: () => undefined,
    probeBridge: async () => spawned,
    sleep: async () => undefined,
  });

  await manager.start();
  assert.equal(await readFile(paths.rotatedLogPath, 'utf8'), '0123456789abcdef');
});

test('stop escalates to force only when graceful termination does not exit', async () => {
  const homeDir = await fixtureHome();
  const paths = getServicePaths({ homeDir });
  const setup = createServiceManager({ homeDir, probeBridge: async () => false });
  await setup.ensureDirectories();
  await writeFile(paths.metadataPath, JSON.stringify({
    version: 1,
    pid: 8080,
    entryPath: '/service.js',
    startedAt: '2026-01-01T00:00:00.000Z',
    logPath: paths.logPath,
    nonce: 'test-nonce',
  }), 'utf8');
  let running = true;
  const signals: string[] = [];
  const manager = createServiceManager({
    homeDir,
    isProcessRunning: () => running,
    terminateProcess: (_pid, signal) => {
      signals.push(signal);
      if (signal === 'SIGKILL') running = false;
    },
    probeBridge: async () => running,
    stopTimeoutMs: 2,
    sleep: async () => undefined,
  });

  await manager.stop();
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});
