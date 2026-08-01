import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  resolveToolInvocation,
  isUnsafeLegacyCommandEnabled,
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

test('restricts npm.run to verification-oriented scripts', () => {
  assert.throws(
    () => resolveToolInvocation('npm.run', ['postinstall'], '/tmp/project'),
    /not an approved verification script/,
  );

  const invocation = resolveToolInvocation('npm.run', ['test:unit'], '/tmp/project');
  assert.deepEqual(invocation.args, ['run', 'test:unit']);
});


test('classifies package installation as a write operation', () => {
  const invocation = resolveToolInvocation('pnpm.install', [], '/tmp/project');
  assert.equal(invocation.risk, 'WRITE');
  assert.deepEqual(invocation.args, ['install']);
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
