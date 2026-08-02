import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  isUnsafeLegacyCommandEnabled,
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

test('Windows command shims quote executable paths containing spaces', () => {
  if (process.platform !== 'win32') {
    return;
  }
  const npm = resolveToolInvocation('npm.test', [], '/tmp/project');
  // Verify that executable paths are properly quoted in the cmd.exe /c invocation
  assert.equal(npm.shell, false);
  const cFlagIndex = npm.args.indexOf('/c');
  assert.ok(cFlagIndex >= 0);
  const executableArg = npm.args[cFlagIndex + 1];
  assert.ok(executableArg);
  // If the executable path contains spaces, it should be quoted
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
