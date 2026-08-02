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

test('resolves git.status without a shell', () => {
  const root = path.resolve('/tmp/project');
  const invocation = resolveToolInvocation('git.status', [], root);

  assert.equal(invocation.executable, 'git');
  assert.deepEqual(invocation.args, ['status', '--short', '--branch']);
  assert.equal(invocation.cwd, root);
  assert.equal(invocation.risk, 'READ');
  assert.equal(invocation.shell, false);
});

test('preserves the established built-in tool invocation contracts', () => {
  const root = path.resolve('/tmp/project');
  const cases = [
    ['git.diff', [], 'git', ['diff'], 'READ'],
    ['git.diff', ['--staged'], 'git', ['diff', '--staged'], 'READ'],
    ['git.log', [], 'git', ['log', '--oneline', '--decorate', '-n', '20'], 'READ'],
    ['git.log', ['5'], 'git', ['log', '--oneline', '--decorate', '-n', '5'], 'READ'],
    ['git.branch.current', [], 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], 'READ'],
    ['node.version', [], process.execPath, ['--version'], 'READ'],
    ['vscode.open', [], process.platform === 'win32' ? 'code.cmd' : 'code', ['.'], 'SAFE_EXECUTION'],
  ] as const;

  for (const [toolId, args, executable, expectedArgs, risk] of cases) {
    const invocation = resolveToolInvocation(toolId, [...args], root);
    if (process.platform === 'win32' && executable.endsWith('.cmd')) {
      assert.equal(invocation.executable.toLowerCase(), (process.env.COMSPEC ?? 'cmd.exe').toLowerCase());
      assert.deepEqual(invocation.args.slice(0, 4), ['/d', '/s', '/c', executable]);
      assert.deepEqual(invocation.args.slice(4), expectedArgs);
    } else {
      assert.equal(invocation.executable, executable);
      assert.deepEqual(invocation.args, expectedArgs);
    }
    assert.equal(invocation.risk, risk);
    assert.equal(invocation.cwd, root);
    assert.equal(invocation.shell, false);
  }
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

  assert.throws(() => {
    (manifests as unknown as Array<unknown>).push({});
  }, TypeError);
});

test('adds bounded Git repository discovery tools', () => {
  const root = path.resolve('/tmp/project');

  assert.deepEqual(resolveToolInvocation('git.root', [], root).args, ['rev-parse', '--show-toplevel']);
  assert.deepEqual(resolveToolInvocation('git.branch.list', [], root).args, [
    'branch',
    '--format=%(refname:short)',
  ]);
  assert.deepEqual(resolveToolInvocation('git.branch.list', ['--all'], root).args, [
    'branch',
    '--all',
    '--format=%(refname:short)',
  ]);
  assert.deepEqual(resolveToolInvocation('git.remote.list', [], root).args, ['remote']);
  assert.deepEqual(resolveToolInvocation('git.show', ['main'], root).args, [
    'show',
    '--no-ext-diff',
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
    assert.equal(invocation.executable, 'git');
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
    'main\nnext',
  ]) {
    assert.throws(
      () => resolveToolInvocation('git.show', [revision], '/tmp/project'),
      /safe Git revision/,
    );
  }

  assert.throws(() => resolveToolInvocation('git.show', [], '/tmp/project'), /exactly one revision/);
  assert.throws(
    () => resolveToolInvocation('git.show', ['main', 'README.md'], '/tmp/project'),
    /exactly one revision/,
  );
});

test('rejects unknown tool identifiers', () => {
  assert.throws(
    () => resolveToolInvocation('shell.exec', ['rm', '-rf', '.'], '/tmp/project'),
    /Unsupported tool/,
  );
});

test('restricts npm.run to verification-oriented names without calling them safe', () => {
  assert.throws(
    () => resolveToolInvocation('npm.run', ['postinstall'], '/tmp/project'),
    /not an approved verification script/,
  );

  for (const [toolId, args] of [
    ['npm.test', []],
    ['npm.run', ['test:unit']],
    ['pnpm.test', []],
    ['pnpm.run', ['build']],
  ] as const) {
    const invocation = resolveToolInvocation(toolId, [...args], '/tmp/project');
    assert.equal(invocation.risk, 'ARBITRARY_EXECUTION');
    assert.equal(requiresExplicitApproval(invocation.risk), true);
    assert.ok(toolInputFiles(invocation).some((input) => input.path === 'package.json' && input.required));
    assert.equal(invocation.shell, false);
  }
});

test('dependency installs disable lifecycle scripts, enforce lockfiles, and require network approval', () => {
  const npm = resolveToolInvocation('npm.install', [], '/tmp/project');
  assert.equal(npm.risk, 'NETWORK_WRITE');
  assert.deepEqual(npm.args.slice(-2), ['ci', '--ignore-scripts']);
  assert.match(npm.displayCommand, /npm(?:\.cmd)? ci --ignore-scripts/);
  assert.equal(requiresExplicitApproval(npm.risk), true);
  assert.ok(toolInputFiles(npm).some((input) => input.path === 'package-lock.json' && input.required));

  const pnpm = resolveToolInvocation('pnpm.install', [], '/tmp/project');
  assert.equal(pnpm.risk, 'NETWORK_WRITE');
  assert.deepEqual(pnpm.args.slice(-3), ['install', '--frozen-lockfile', '--ignore-scripts']);
  assert.match(pnpm.displayCommand, /pnpm(?:\.cmd)? install --frozen-lockfile --ignore-scripts/);
  assert.equal(requiresExplicitApproval(pnpm.risk), true);
  assert.ok(toolInputFiles(pnpm).some((input) => input.path === 'pnpm-lock.yaml' && input.required));
});

test('Windows command shims remain shell-disabled and use the system command processor explicitly', () => {
  const npm = resolveToolInvocation('npm.test', [], '/tmp/project');
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
