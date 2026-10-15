import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitConfiguredHelperError } from '../git/hardened-read.ts';
import { readProjectStatus, redactRemoteUrl } from './status.ts';

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
  assert.equal(clean.packageManager, 'npm');

  writeFileSync(path.join(root, 'README.md'), '# changed\n');
  const dirty = await readProjectStatus(root);
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.changedFiles, 1);
});

test('automatic project status refuses configured content filters before execution', async () => {
  const root = createRepository();
  const { command, sentinel } = createHelper(root);
  writeFileSync(path.join(root, '.gitattributes'), 'package.json filter=evil\n');
  execFileSync('git', ['config', 'filter.evil.clean', command], { cwd: root });
  writeFileSync(path.join(root, 'package.json'), '{"name":"changed"}\n');

  await assert.rejects(
    readProjectStatus(root, {
      env: {
        ...process.env,
        OPENBROWSER_TEST_SENTINEL: sentinel,
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof GitConfiguredHelperError);
      assert.ok(error.configKeys.includes('filter.evil.clean'));
      return true;
    },
  );
  assert.equal(existsSync(sentinel), false);
});

test('automatic project status ignores user, system, and command-scope helper injection', async () => {
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
  assert.equal(existsSync(sentinel), false);
});

test('redacts credentials from HTTPS URLs with password', () => {
  assert.equal(
    redactRemoteUrl('https://user:password@github.com/org/repo.git'),
    'https://***@github.com/org/repo.git',
  );
});

test('redacts credentials from HTTPS URLs with username only', () => {
  assert.equal(
    redactRemoteUrl('https://user@github.com/org/repo.git'),
    'https://***@github.com/org/repo.git',
  );
});

test('redacts credentials from HTTP URLs', () => {
  assert.equal(
    redactRemoteUrl('http://user:pass@example.com/repo.git'),
    'http://***@example.com/repo.git',
  );
});

test('redacts credentials from git+https URLs', () => {
  assert.equal(
    redactRemoteUrl('git+https://user:token@github.com/org/repo.git'),
    'git+https://***@github.com/org/repo.git',
  );
});

test('redacts credentials from ssh+git URLs', () => {
  assert.equal(
    redactRemoteUrl('ssh+git://user:pass@host/repo.git'),
    'ssh+git://***@host/repo.git',
  );
});

test('leaves URLs without credentials unchanged', () => {
  assert.equal(
    redactRemoteUrl('https://github.com/org/repo.git'),
    'https://github.com/org/repo.git',
  );
});

test('leaves SSH URLs unchanged', () => {
  assert.equal(
    redactRemoteUrl('git@github.com:org/repo.git'),
    'git@github.com:org/repo.git',
  );
});

test('handles complex passwords with special characters', () => {
  assert.equal(
    redactRemoteUrl('https://user:p%40ss%3Aword@github.com/org/repo.git'),
    'https://***@github.com/org/repo.git',
  );
});

test('handles empty strings', () => {
  assert.equal(redactRemoteUrl(''), '');
});

test('handles file:// URLs without credentials', () => {
  assert.equal(
    redactRemoteUrl('file:///path/to/repo'),
    'file:///path/to/repo',
  );
});
