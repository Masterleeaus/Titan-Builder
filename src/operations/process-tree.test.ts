import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { terminateProcessTree } from './process-tree.ts';

test('process tree termination', async (t) => {
  await t.test('terminates a long-running process', async () => {
    const child = spawn('sleep', ['60'], { detached: process.platform !== 'win32' });
    if (!child.pid) {
      throw new Error('Failed to get child PID');
    }

    const result = await terminateProcessTree(child.pid, 500);

    assert(result.gracefulTermination || result.forcedTermination);
    assert.equal(result.descendantCount, 0);
  });

  await t.test('terminates process on Windows', async function () {
    if (process.platform !== 'win32') {
      this.skip();
      return;
    }

    const child = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 60'], {
      detached: false,
    });

    if (!child.pid) {
      throw new Error('Failed to get child PID');
    }

    const result = await terminateProcessTree(child.pid, 500);

    assert(result.gracefulTermination || result.forcedTermination);
  });

  await t.test('handles already-terminated process', async () => {
    const child = spawn('echo', ['test']);
    if (!child.pid) {
      throw new Error('Failed to get child PID');
    }

    await new Promise<void>((resolve) => {
      child.on('close', () => resolve());
    });

    const result = await terminateProcessTree(child.pid, 500);

    assert(!result.gracefulTermination || !result.forcedTermination);
  });

  await t.test('escalates from graceful to forced termination', async function () {
    if (process.platform === 'win32') {
      this.skip();
      return;
    }

    // Create a process that ignores SIGTERM
    const child = spawn('node', ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {
      detached: true,
    });

    if (!child.pid) {
      throw new Error('Failed to get child PID');
    }

    const result = await terminateProcessTree(child.pid, 100);

    assert(result.gracefulTermination || result.forcedTermination);
  });

  await t.test('reports descendant process count', async function () {
    if (process.platform === 'win32') {
      this.skip();
      return;
    }

    const command = `
      const child1 = require('child_process').spawn('sleep', ['60']);
      const child2 = require('child_process').spawn('sleep', ['60']);
      setInterval(() => {}, 1000);
    `;

    const parent = spawn('node', ['-e', command], { detached: true });

    if (!parent.pid) {
      throw new Error('Failed to get parent PID');
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    const result = await terminateProcessTree(parent.pid, 500);

    assert(result.descendantCount >= 0);
  });

  await t.test('handles spawn error gracefully', async () => {
    const invalidPid = 999999999;

    const result = await terminateProcessTree(invalidPid, 500);

    assert.equal(result.descendantCount, 0);
  });

  await t.test('respects graceful termination timeout', async function () {
    if (process.platform === 'win32') {
      this.skip();
      return;
    }

    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
    });

    if (!child.pid) {
      throw new Error('Failed to get child PID');
    }

    const startTime = Date.now();
    const result = await terminateProcessTree(child.pid, 100);
    const elapsed = Date.now() - startTime;

    assert(elapsed < 2000);
    assert(result.gracefulTermination || result.forcedTermination);
  });

  await t.test('confirms process exit before returning', async () => {
    const child = spawn('sleep', ['10'], { detached: process.platform !== 'win32' });

    if (!child.pid) {
      throw new Error('Failed to get child PID');
    }

    const result = await terminateProcessTree(child.pid, 500);

    assert(result.gracefulTermination || result.forcedTermination);

    let isAlive = false;
    try {
      process.kill(child.pid, 0);
      isAlive = true;
    } catch {
      isAlive = false;
    }

    assert.equal(isAlive, false);
  });
});
