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

const TEST_PROJECT_ROOT = '/test-project';

function gitArgs(invocation: ToolInvocation): string[] {
  assert.equal(invocation.executable, process.execPath);
  const runnerIndex = invocation.args.findIndex((argument) => /hardened-cli\.(?:ts|js)$/u.test(argument));
  assert.ok(runnerIndex >= 0, `missing hardened runner in ${invocation.args.join(' ')}`);
  return invocation.args.slice(runnerIndex + 1);
}

test('resolves git.status through the hardened runner with explicit approval', () => {
  const root = path.resolve(TEST_PROJECT_ROOT);
  const invocation = resolveToolInvocation('git.status', [], root);

  assert.deepEqual(gitArgs(invocation), ['status', '--short', '--branch']);
  assert.equal(invocation.cwd, root);
  assert.equal(invocation.risk, 'ARBITRARY_EXECUTION');
  assert.equal(requiresExplicitApproval(invocation.risk), true);
  assert.equal(invocation.shell, false);
});

test('preserves built-in logical arguments behind the hardened Git boundary', () => {
  const root = path.resolve('/tmp/project');
  const cases = [
    ['git.diff', [], ['diff', '--no-ext-diff', '--no-textconv'], 'ARBITRARY_EXECUTION'],
    ['git.diff', ['--staged'], ['diff', '--no-ext-diff', '--no-textconv', '--staged'], 'ARBITRARY_EXECUTION'],
    ['git.log', [], ['log', '--oneline', '--decorate', '-n', '20'], 'READ'],
    ['git.log', ['5'], ['log', '--oneline', '--decorate', '-n', '5'], 'READ'],
    ['git.branch.current', [], ['rev-parse', '--abbrev-ref', 'HEAD'], 'READ'],
  ] as const;

  for (const [toolId, args, expectedArgs, risk] of cases) {
    const invocation = resolveToolInvocation(toolId, [...args], root);
    assert.deepEqual(gitArgs(invocation), expectedArgs);
    assert.equal(invocation.risk, risk);
    assert.equal(invocation.cwd, root);
    assert.equal(invocation.shell, false);
  }

  const node = resolveToolInvocation('node.version', [], root);
  assert.equal(node.executable, process.execPath);
  assert.deepEqual(node.args, ['--version']);
  assert.equal(node.risk, 'READ');

  const vscode = resolveToolInvocation('vscode.open', [], root);
  if (process.platform === 'win32') {
    assert.equal(vscode.executable.toLowerCase(), (process.env.COMSPEC ?? 'cmd.exe').toLowerCase());
    assert.deepEqual(vscode.args.slice(0, 4), ['/d', '/s', '/c', 'code.cmd']);
    assert.deepEqual(vscode.args.slice(4), ['.']);
  } else {
    assert.equal(vscode.executable, 'code');
    assert.deepEqual(vscode.args, ['.']);
  }
  assert.equal(vscode.risk, 'SAFE_EXECUTION');
  assert.equal(vscode.shell, false);
});

test('exposes deterministic public manifests for every supported tool', () => {
  const manifests = listToolManifests();
  const runtimeIds = manifests.map((manifest) => manifest.runtimeId);

  assert.deepEqual(runtimeIds, [...runtimeIds].sort());
  assert.ok(runtimeIds.includes('git.status'));
  assert.ok(runtimeIds.includes('pnpm.run'));
  assert.equal(new Set(runtimeIds).size, runtimeIds.length);

  for (const manifest of manifests) {
    assert.match(manifest.id, /^titan\.tool\./u);
    assert.match(manifest.version, /^\d+\.\d+\.\d+/u);
    assert.ok(manifest.purpose.length > 0);
    assert.ok(manifest.responsibilities.length > 0);
    assert.ok(manifest.securityConsiderations.length > 0);
    assert.ok(manifest.validation.length > 0);
    assert.ok(manifest.tests.length > 0);
    assert.ok(manifest.documentation.length > 0);
    assert.ok(manifest.examples.length > 0);
    assert.equal(Object.hasOwn(manifest, 'resolver'), false);
    assert.equal(Object.hasOwn(manifest, 'executable'), false);
  }

  const status = manifests.find((manifest) => manifest.runtimeId === 'git.status');
  const diff = manifests.find((manifest) => manifest.runtimeId === 'git.diff');
  assert.equal(status?.risk, 'ARBITRARY_EXECUTION');
  assert.equal(status?.approval, 'explicit');
  assert.equal(diff?.risk, 'ARBITRARY_EXECUTION');
  assert.equal(diff?.approval, 'explicit');

  assert.throws(() => {
    (manifests as unknown as Array<unknown>).push({});
  }, TypeError);
});

test('adds bounded Git repository discovery tools through hardened execution', () => {
  const root = path.resolve('/tmp/project');

  assert.deepEqual(gitArgs(resolveToolInvocation('git.root', [], root)), ['rev-parse', '--show-toplevel']);
  assert.deepEqual(gitArgs(resolveToolInvocation('git.branch.list', [], root)), [
    'branch',
    '--format=%(refname:short)',
  ]);
  assert.deepEqual(gitArgs(resolveToolInvocation('git.branch.list', ['--all'], root)), [
    'branch',
    '--all',
    '--format=%(refname:short)',
  ]);
  assert.deepEqual(gitArgs(resolveToolInvocation('git.remote.list', [], root)), ['remote']);
  assert.deepEqual(gitArgs(resolveToolInvocation('git.show', ['main'], root)), [
    'show',
    '--no-ext-diff',
    '--no-textconv',
    '--stat',
    '--oneline',
    '--decorate',
    '--no-renames',
    'main',
    '--',
  ]);

  for (const toolId of ['git.root', 'git.branch.list', 'git.remote.list', 'git.show']) {
    const args = toolId === 'git.show' ? ['main'] : [];
    const invocation = resolveToolInvocation(toolId, args, root);
    assert.equal(invocation.executable, process.execPath);
    assert.equal(invocation.risk, 'READ');
    assert.equal(invocation.shell, false);
  }
});

test('rejects Git discovery argument injection and unsupported modes', () => {
  assert.throws(() => resolveToolInvocation('git.root', ['extra'], '/tmp/project'), /accepts no arguments/);
  assert.throws(() => resolveToolInvocation('git.remote.list', ['-v'], '/tmp/project'), /accepts no arguments/);
  assert.throws(
    () => resolveToolInvocation('git.branch.list', ['--merged'], '/tmp/project'),
    /accepts no arguments or only --all/,
  );

  for (const revision of [
    '-p',
    'main..other',
    'main@{1}',
    'main~1',
    'main^',
    'main:path',
    'main path',
    'main\\path',
  ]) {
    assert.throws(
      () => resolveToolInvocation('git.show', [revision], '/tmp/project'),
      /safe Git revision/,
    );
  }

  assert.throws(
    () => resolveToolInvocation('git.show', ['main\nnext'], '/tmp/project'),
    /control characters/,
  );
  assert.throws(() => resolveToolInvocation('git.show', [], '/tmp/project'), /exactly one revision/);
  assert.throws(
    () => resolveToolInvocation('git.show', ['main', 'README.md'], '/tmp/project'),
    /exactly one revision/,
  );
});

test('rejects unknown tool identifiers', () => {
  assert.throws(
    () => resolveToolInvocation('shell.exec', ['rm', '-rf', '.'], TEST_PROJECT_ROOT),
    /Unsupported tool/,
  );
});

test('restricts npm.run to verification-oriented names without calling them safe', () => {
  assert.throws(
    () => resolveToolInvocation('npm.run', ['postinstall'], TEST_PROJECT_ROOT),
    /not an approved verification script/,
  );

  for (const [toolId, args] of [
    ['npm.test', []],
    ['npm.run', ['test:unit']],
    ['pnpm.test', []],
    ['pnpm.run', ['build']],
  ] as const) {
    const invocation = resolveToolInvocation(toolId, [...args], TEST_PROJECT_ROOT);
    assert.equal(invocation.risk, 'ARBITRARY_EXECUTION');
    assert.equal(requiresExplicitApproval(invocation.risk), true);
    assert.ok(toolInputFiles(invocation).some((input) => input.path === 'package.json' && input.required));
    assert.equal(invocation.shell, false);
  }
});

test('dependency installs disable lifecycle scripts, enforce lockfiles, and require network approval', () => {
  const npm = resolveToolInvocation('npm.install', [], TEST_PROJECT_ROOT);
  assert.equal(npm.risk, 'NETWORK_WRITE');
  assert.deepEqual(npm.args.slice(-2), ['ci', '--ignore-scripts']);
  assert.match(npm.displayCommand, /npm(?:\.cmd)? ci --ignore-scripts/);
  assert.equal(requiresExplicitApproval(npm.risk), true);
  assert.ok(toolInputFiles(npm).some((input) => input.path === 'package-lock.json' && input.required));

  const pnpm = resolveToolInvocation('pnpm.install', [], TEST_PROJECT_ROOT);
  assert.equal(pnpm.risk, 'NETWORK_WRITE');
  assert.deepEqual(pnpm.args.slice(-3), ['install', '--frozen-lockfile', '--ignore-scripts']);
  assert.match(pnpm.displayCommand, /pnpm(?:\.cmd)? install --frozen-lockfile --ignore-scripts/);
  assert.equal(requiresExplicitApproval(pnpm.risk), true);
  assert.ok(toolInputFiles(pnpm).some((input) => input.path === 'pnpm-lock.yaml' && input.required));
});

test('Windows command shims remain shell-disabled and use the system command processor explicitly', () => {
  const npm = resolveToolInvocation('npm.test', [], TEST_PROJECT_ROOT);
  if (process.platform === 'win32') {
    assert.equal(npm.executable.toLowerCase(), (process.env.COMSPEC ?? 'cmd.exe').toLowerCase());
    assert.deepEqual(npm.args.slice(0, 4), ['/d', '/s', '/c', 'npm.cmd']);
  } else {
    assert.equal(npm.executable, 'npm');
    assert.deepEqual(npm.args, ['test']);
  }
  assert.equal(npm.shell, false);
});

test('Windows command shims quote executable paths containing spaces', () => {
  if (process.platform !== 'win32') {
    return;
  }
  const npm = resolveToolInvocation('npm.test', [], '/tmp/project');
  assert.equal(npm.shell, false);
  const cFlagIndex = npm.args.indexOf('/c');
  assert.ok(cFlagIndex >= 0);
  const executableArg = npm.args[cFlagIndex + 1];
  assert.ok(executableArg);
  if (executableArg.includes(' ') && !executableArg.startsWith('"')) {
    throw new Error(`Executable with spaces must be quoted: ${executableArg}`);
  }
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
