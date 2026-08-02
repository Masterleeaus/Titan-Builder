import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  isUnsafeLegacyCommandEnabled,
  listToolManifests,
  requiresExplicitApproval,
  resolveToolInvocation,
  toolInputFiles,
} from './registry.ts';
import type { ToolInvocation } from './types.ts';

const root = path.resolve('/tmp/project');

function gitArgs(invocation: ToolInvocation): string[] {
  assert.equal(invocation.executable, process.execPath);
  assert.equal(invocation.args[0], '--experimental-strip-types');
  assert.match(invocation.args[1] ?? '', /hardened-cli\.ts$/u);
  return invocation.args.slice(2);
}

test('resolves git.status through the hardened runner and requires approval', () => {
  const invocation = resolveToolInvocation('git.status', [], root);

  assert.equal(invocation.cwd, root);
  assert.deepEqual(gitArgs(invocation), ['status', '--short', '--branch']);
  assert.equal(invocation.risk, 'ARBITRARY_EXECUTION');
  assert.equal(requiresExplicitApproval(invocation.risk), true);
  assert.equal(invocation.displayCommand, 'git status --short --branch');
  assert.equal(invocation.shell, false);
});

test('registered Git tools preserve bounded logical arguments behind the runner', () => {
  const cases = [
    ['git.diff', [], ['diff', '--no-ext-diff', '--no-textconv'], 'ARBITRARY_EXECUTION'],
    ['git.diff', ['--staged'], ['diff', '--no-ext-diff', '--no-textconv', '--staged'], 'ARBITRARY_EXECUTION'],
    ['git.log', ['5'], ['log', '--oneline', '--decorate', '-n', '5'], 'READ'],
    ['git.branch.current', [], ['rev-parse', '--abbrev-ref', 'HEAD'], 'READ'],
    ['git.root', [], ['rev-parse', '--show-toplevel'], 'READ'],
    ['git.branch.list', [], ['branch', '--format=%(refname:short)'], 'READ'],
    ['git.branch.list', ['--all'], ['branch', '--all', '--format=%(refname:short)'], 'READ'],
    ['git.remote.list', [], ['remote'], 'READ'],
  ] as const;

  for (const [toolId, args, expectedArgs, risk] of cases) {
    const invocation = resolveToolInvocation(toolId, [...args], root);
    assert.deepEqual(gitArgs(invocation), expectedArgs);
    assert.equal(invocation.risk, risk);
    assert.equal(invocation.shell, false);
  }

  assert.throws(() => resolveToolInvocation('git.diff', ['--stat'], root), /only --staged/u);
  assert.throws(() => resolveToolInvocation('git.log', ['0'], root), /between 1 and 100/u);
  assert.throws(() => resolveToolInvocation('git.log', ['101'], root), /between 1 and 100/u);
  assert.throws(() => resolveToolInvocation('git.branch.list', ['--verbose'], root), /only --all/u);
  assert.throws(() => resolveToolInvocation('git.remote.list', ['origin'], root), /accepts no arguments/u);
});

test('git.show rejects revision expressions and disables external diff and textconv', () => {
  const invocation = resolveToolInvocation('git.show', ['HEAD'], root);
  assert.deepEqual(gitArgs(invocation), [
    'show',
    '--no-ext-diff',
    '--no-textconv',
    '--stat',
    '--oneline',
    '--decorate',
    '--no-renames',
    'HEAD',
    '--',
  ]);
  assert.equal(invocation.risk, 'READ');

  for (const revision of [
    '--help',
    'HEAD..main',
    'HEAD~1',
    'HEAD^',
    'HEAD@{1}',
    'HEAD:package.json',
    'HEAD^{tree}',
    ':/message',
    'HEAD -- package.json',
    'refs\\heads\\main',
  ]) {
    assert.throws(
      () => resolveToolInvocation('git.show', [revision], root),
      /safe Git revision/u,
    );
  }
});

test('rejects unknown tools and restricts package scripts to verification names', () => {
  assert.throws(
    () => resolveToolInvocation('shell.exec', ['rm', '-rf', '.'], root),
    /Unsupported tool/u,
  );
  assert.throws(
    () => resolveToolInvocation('npm.run', ['postinstall'], root),
    /not an approved verification script/u,
  );

  for (const [toolId, args] of [
    ['npm.test', []],
    ['npm.run', ['test:unit']],
    ['pnpm.test', []],
    ['pnpm.run', ['build']],
  ] as const) {
    const invocation = resolveToolInvocation(toolId, [...args], root);
    assert.equal(invocation.risk, 'ARBITRARY_EXECUTION');
    assert.equal(requiresExplicitApproval(invocation.risk), true);
    assert.equal(invocation.shell, false);
    assert.ok(toolInputFiles(invocation).some((input) => input.path === 'package.json' && input.required));
  }
});

test('dependency installs disable lifecycle scripts, enforce lockfiles, and require network approval', () => {
  const npm = resolveToolInvocation('npm.install', [], root);
  assert.equal(npm.risk, 'NETWORK_WRITE');
  assert.deepEqual(npm.args.slice(-2), ['ci', '--ignore-scripts']);
  assert.match(npm.displayCommand, /npm(?:\.cmd)? ci --ignore-scripts/u);
  assert.equal(requiresExplicitApproval(npm.risk), true);
  assert.ok(toolInputFiles(npm).some((input) => input.path === 'package-lock.json' && input.required));

  const pnpm = resolveToolInvocation('pnpm.install', [], root);
  assert.equal(pnpm.risk, 'NETWORK_WRITE');
  assert.deepEqual(pnpm.args.slice(-3), ['install', '--frozen-lockfile', '--ignore-scripts']);
  assert.match(pnpm.displayCommand, /pnpm(?:\.cmd)? install --frozen-lockfile --ignore-scripts/u);
  assert.equal(requiresExplicitApproval(pnpm.risk), true);
  assert.ok(toolInputFiles(pnpm).some((input) => input.path === 'pnpm-lock.yaml' && input.required));
});

test('public manifests are deterministic, immutable, and expose worktree approval risk', () => {
  const manifests = listToolManifests();
  const ids = manifests.map((manifest) => manifest.runtimeId);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(Object.isFrozen(manifests), true);

  const status = manifests.find((manifest) => manifest.runtimeId === 'git.status');
  const diff = manifests.find((manifest) => manifest.runtimeId === 'git.diff');
  assert.equal(status?.risk, 'ARBITRARY_EXECUTION');
  assert.equal(status?.approval, 'explicit');
  assert.equal(diff?.risk, 'ARBITRARY_EXECUTION');
  assert.equal(diff?.approval, 'explicit');
  assert.equal(Object.isFrozen(status), true);
});

test('Windows command shims remain shell-disabled and use the command processor explicitly', () => {
  const npm = resolveToolInvocation('npm.test', [], root);
  if (process.platform === 'win32') {
    assert.equal(npm.executable.toLowerCase(), (process.env.COMSPEC ?? 'cmd.exe').toLowerCase());
    assert.deepEqual(npm.args.slice(0, 4), ['/d', '/s', '/c', 'npm.cmd']);
  } else {
    assert.equal(npm.executable, 'npm');
    assert.deepEqual(npm.args, ['test']);
  }
  assert.equal(npm.shell, false);
});

test('only genuinely low-side-effect risks bypass per-operation approval', () => {
  assert.equal(requiresExplicitApproval('READ'), false);
  assert.equal(requiresExplicitApproval('SAFE_EXECUTION'), false);
  assert.equal(requiresExplicitApproval('WRITE'), false);
  assert.equal(requiresExplicitApproval('NETWORK_WRITE'), true);
  assert.equal(requiresExplicitApproval('ARBITRARY_EXECUTION'), true);
  assert.equal(requiresExplicitApproval('DESTRUCTIVE'), true);
  assert.equal(requiresExplicitApproval('PUBLISH'), true);
});

test('legacy arbitrary commands are disabled by default', () => {
  const previous = process.env.OPENBROWSER_ALLOW_UNSAFE_COMMANDS;
  delete process.env.OPENBROWSER_ALLOW_UNSAFE_COMMANDS;
  assert.equal(isUnsafeLegacyCommandEnabled(), false);

  process.env.OPENBROWSER_ALLOW_UNSAFE_COMMANDS = '1';
  assert.equal(isUnsafeLegacyCommandEnabled(), true);

  if (previous === undefined) {
    delete process.env.OPENBROWSER_ALLOW_UNSAFE_COMMANDS;
  } else {
    process.env.OPENBROWSER_ALLOW_UNSAFE_COMMANDS = previous;
  }
});
