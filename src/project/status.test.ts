import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readProjectStatus } from './status.ts';

function createRepository(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openbrowser-status-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'OpenBrowser Test'], { cwd: root });
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  execFileSync('git', ['add', 'package.json'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'initial'], { cwd: root });
  return root;
}

function createHelper(root: string): { command: string; sentinel: string } {
  const helperPath = path.join(root, 'status-helper.mjs');
  const sentinel = path.join(root, 'status-helper-executed.txt');
  writeFileSync(helperPath, [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(process.env.OPENBROWSER_TEST_SENTINEL, 'executed');",
    "if (!process.stdin.isTTY) process.stdin.pipe(process.stdout);",
    "else process.stdout.write('0\\n');",
  ].join('\n'));
  const executable = process.execPath.replaceAll('\\', '/');
  const script = helperPath.replaceAll('\\', '/');
  return {
    command: `\"${executable}\" \"${script}\"`,
    sentinel,
  };
}

test('reads branch and dirty state from a git project', async () => {
  const root = createRepository();

  const clean = await readProjectStatus(root);
  assert.equal(clean.isGitRepository, true);
  assert.equal(clean.branch.length > 0, true);
  assert.equal(clean.dirty, false);
  assert.equal(clean.changedFiles, 0);
  assert.equal(clean.workingTreeReason, undefined);
  assert.equal(clean.packageManager, 'npm');

  writeFileSync(path.join(root, 'README.md'), '# changed\n');
  const dirty = await readProjectStatus(root);
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.changedFiles, 1);
  assert.equal(dirty.workingTreeReason, undefined);
});

test('automatic project status does not execute configured content filters', async () => {
  const root = createRepository();
  const { command, sentinel } = createHelper(root);
  writeFileSync(path.join(root, '.gitattributes'), 'package.json filter=evil\n');
  execFileSync('git', ['config', 'filter.evil.clean', command], { cwd: root });
  writeFileSync(path.join(root, 'package.json'), '{"name":"changed"}\n');

  const status = await readProjectStatus(root, {
    env: {
      ...process.env,
      OPENBROWSER_TEST_SENTINEL: sentinel,
    },
  });

  assert.equal(status.isGitRepository, true);
  assert.equal(status.dirty, null);
  assert.equal(status.changedFiles, null);
  assert.match(status.workingTreeReason ?? '', /configured Git helpers require explicit approval/i);
  assert.equal(existsSync(sentinel), false);
});

test('automatic project status ignores user, system, and command-scope Git helper injection', async () => {
  const root = createRepository();
  const { command, sentinel } = createHelper(root);
  const maliciousConfig = path.join(root, 'malicious.gitconfig');
  writeFileSync(maliciousConfig, [
    '[core]',
    `\tfsmonitor = ${command}`,
    '[alias]',
    `\tstatus = !${command}`,
  ].join('\n'));
  writeFileSync(path.join(root, 'README.md'), '# changed\n');

  const status = await readProjectStatus(root, {
    env: {
      ...process.env,
      OPENBROWSER_TEST_SENTINEL: sentinel,
      GIT_CONFIG_GLOBAL: maliciousConfig,
      GIT_CONFIG_SYSTEM: maliciousConfig,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: command,
    },
  });

  assert.equal(status.dirty, true);
  assert.equal(status.changedFiles, 3);
  assert.equal(status.workingTreeReason, undefined);
  assert.equal(existsSync(sentinel), false);
});
