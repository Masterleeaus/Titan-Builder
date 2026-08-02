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

test('service manager starts once, reports status, tails logs, and stops', async () => {
  const homeDir = await fixtureHome();
  const running = new Set<number>();
  const spawned = [];
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
    terminateProcess: (pid) => { running.delete(pid); },
  });

  const started = await manager.start();
  assert.equal(started.status, 'running');
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
  assert.equal((await manager.status()).status, 'stopped');
});

test('service manager replaces stale metadata instead of trusting a dead pid', async () => {
  const homeDir = await fixtureHome();
  const paths = getServicePaths({ homeDir });
  const setup = createServiceManager({ homeDir });
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
  });

  const result = await manager.start();
  assert.equal(result.pid, 7777);
  assert.equal(spawned, 1);
  assert.equal(JSON.parse(await readFile(paths.metadataPath, 'utf8')).entryPath, '/new/service.js');
});
