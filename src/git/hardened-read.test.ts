import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildHardenedGitInvocation,
  createHardenedGitEnvironment,
  GitConfiguredHelperError,
  runHardenedGit,
} from './hardened-read.ts';

function createRepository(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openbrowser-git-read-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'OpenBrowser Test'], { cwd: root });
  writeFileSync(path.join(root, 'tracked.txt'), 'initial\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'initial'], { cwd: root });
  return root;
}

function createHelper(root: string): { command: string; sentinel: string } {
  const helperPath = path.join(root, 'malicious-helper.mjs');
  const sentinel = path.join(root, 'helper-executed.txt');
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

function executeInvocation(
  invocation: ReturnType<typeof buildHardenedGitInvocation>,
  cwd: string,
): void {
  execFileSync(invocation.executable, invocation.args, {
    cwd,
    env: invocation.env,
    stdio: 'pipe',
    timeout: 15_000,
  });
}

test('sanitizes inherited Git execution and configuration environment', () => {
  const helper = 'malicious-helper';
  const environment = createHardenedGitEnvironment({
    ...process.env,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: helper,
    GIT_CONFIG_KEY_1: 'diff.external',
    GIT_CONFIG_VALUE_1: helper,
    GIT_CONFIG_PARAMETERS: "'core.fsmonitor'='malicious-helper'",
    GIT_CONFIG_GLOBAL: '/tmp/malicious-global',
    GIT_CONFIG_SYSTEM: '/tmp/malicious-system',
    GIT_EXTERNAL_DIFF: helper,
    GIT_EXTERNAL_DIFF_TRUST_EXIT_CODE: 'true',
    GIT_PAGER: helper,
    GIT_EDITOR: helper,
    GIT_SEQUENCE_EDITOR: helper,
    GIT_ASKPASS: helper,
    SSH_ASKPASS: helper,
    GIT_DIR: '/tmp/redirected-git-dir',
    GIT_WORK_TREE: '/tmp/redirected-work-tree',
    GIT_EXEC_PATH: '/tmp/malicious-exec-path',
    GIT_SSH_COMMAND: helper,
    GIT_TRACE: '1',
  });

  assert.equal(environment.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(environment.GIT_CONFIG_GLOBAL, os.devNull);
  assert.equal(environment.GIT_CONFIG_SYSTEM, os.devNull);
  assert.equal(environment.GIT_ATTR_NOSYSTEM, '1');
  assert.equal(environment.GIT_TERMINAL_PROMPT, '0');
  assert.equal(environment.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(environment.GIT_CONFIG_COUNT, undefined);
  assert.equal(environment.GIT_CONFIG_KEY_0, undefined);
  assert.equal(environment.GIT_CONFIG_VALUE_0, undefined);
  assert.equal(environment.GIT_CONFIG_PARAMETERS, undefined);
  assert.equal(environment.GIT_EXTERNAL_DIFF, undefined);
  assert.equal(environment.GIT_DIR, undefined);
  assert.equal(environment.GIT_WORK_TREE, undefined);
  assert.equal(environment.GIT_EXEC_PATH, undefined);
  assert.equal(environment.GIT_SSH_COMMAND, undefined);
  assert.equal(environment.GIT_TRACE, undefined);
});

test('hardened status disables repository fsmonitor and ignores malicious aliases and environment overrides', () => {
  const root = createRepository();
  const { command, sentinel } = createHelper(root);
  execFileSync('git', ['config', 'core.fsmonitor', command], { cwd: root });
  execFileSync('git', ['config', 'alias.status', `!${command}`], { cwd: root });

  const invocation = buildHardenedGitInvocation(
    ['status', '--short', '--branch'],
    {
      ...process.env,
      OPENBROWSER_TEST_SENTINEL: sentinel,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: command,
    },
  );
  executeInvocation(invocation, root);

  assert.equal(existsSync(sentinel), false);
  assert.ok(invocation.args.includes('core.fsmonitor=false'));
  assert.ok(invocation.args.some((argument) => argument.startsWith('core.hooksPath=')));
});

test('hardened diff disables external diff and textconv drivers', () => {
  const root = createRepository();
  const { command, sentinel } = createHelper(root);
  writeFileSync(path.join(root, '.gitattributes'), '*.txt diff=evil\n');
  execFileSync('git', ['config', 'diff.evil.command', command], { cwd: root });
  execFileSync('git', ['config', 'diff.evil.textconv', command], { cwd: root });
  writeFileSync(path.join(root, 'tracked.txt'), 'changed\n');

  const invocation = buildHardenedGitInvocation(
    ['diff', '--no-ext-diff', '--no-textconv'],
    {
      ...process.env,
      OPENBROWSER_TEST_SENTINEL: sentinel,
      GIT_EXTERNAL_DIFF: command,
    },
  );
  executeInvocation(invocation, root);

  assert.equal(existsSync(sentinel), false);
  assert.ok(invocation.args.includes('--no-pager'));
  assert.ok(invocation.args.includes('--no-optional-locks'));
});

test('worktree inspection fails closed before configured content filters execute', async () => {
  const root = createRepository();
  const { command, sentinel } = createHelper(root);
  writeFileSync(path.join(root, '.gitattributes'), '*.txt filter=evil\n');
  execFileSync('git', ['config', 'filter.evil.clean', command], { cwd: root });
  writeFileSync(path.join(root, 'tracked.txt'), 'changed\n');

  await assert.rejects(
    runHardenedGit(root, ['status', '--porcelain'], {
      env: {
        ...process.env,
        OPENBROWSER_TEST_SENTINEL: sentinel,
      },
      rejectConfiguredHelpers: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof GitConfiguredHelperError);
      assert.ok(error.configKeys.includes('filter.evil.clean'));
      return true;
    },
  );
  assert.equal(existsSync(sentinel), false);
});
