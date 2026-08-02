import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  listToolManifests,
  requiresExplicitApproval,
  resolveToolInvocation,
} from './registry.ts';

const root = path.resolve('/tmp/project');

function manifest(runtimeId: string) {
  const value = listToolManifests().find((candidate) => candidate.runtimeId === runtimeId);
  assert.ok(value, `missing manifest for ${runtimeId}`);
  return value;
}

test('worktree-sensitive Git tools require explicit arbitrary-execution approval', () => {
  const status = resolveToolInvocation('git.status', [], root);
  assert.equal(status.risk, 'ARBITRARY_EXECUTION');
  assert.equal(requiresExplicitApproval(status.risk), true);
  assert.deepEqual(status.args, ['status', '--short', '--branch']);
  assert.equal(manifest('git.status').risk, 'ARBITRARY_EXECUTION');
  assert.equal(manifest('git.status').approval, 'explicit');

  const diff = resolveToolInvocation('git.diff', ['--staged'], root);
  assert.equal(diff.risk, 'ARBITRARY_EXECUTION');
  assert.equal(requiresExplicitApproval(diff.risk), true);
  assert.deepEqual(diff.args, ['diff', '--no-ext-diff', '--no-textconv', '--staged']);
  assert.equal(manifest('git.diff').risk, 'ARBITRARY_EXECUTION');
  assert.equal(manifest('git.diff').approval, 'explicit');
});

test('every registered Git tool uses the closed execution environment', () => {
  const cases = [
    ['git.status', []],
    ['git.diff', []],
    ['git.log', ['5']],
    ['git.branch.current', []],
    ['git.root', []],
    ['git.branch.list', ['--all']],
    ['git.remote.list', []],
    ['git.show', ['HEAD']],
  ] as const;

  for (const [toolId, args] of cases) {
    const invocation = resolveToolInvocation(toolId, [...args], root);
    assert.equal(invocation.executable, 'git');
    assert.equal(invocation.shell, false);
    assert.equal(invocation.env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(invocation.env.GIT_CONFIG_GLOBAL, os.devNull);
    assert.equal(invocation.env.GIT_CONFIG_SYSTEM, os.devNull);
    assert.equal(invocation.env.GIT_ATTR_NOSYSTEM, '1');
    assert.equal(invocation.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(invocation.env.GIT_OPTIONAL_LOCKS, '0');
    assert.equal(invocation.env.GIT_CONFIG_KEY_0, 'core.fsmonitor');
    assert.equal(invocation.env.GIT_CONFIG_VALUE_0, 'false');
    assert.equal(invocation.env.GIT_CONFIG_KEY_1, 'core.hooksPath');
    assert.equal(invocation.env.GIT_CONFIG_KEY_2, 'diff.external');
    assert.equal(invocation.env.GIT_CONFIG_VALUE_2, '');
    assert.equal(invocation.env.GIT_EXTERNAL_DIFF, undefined);
    assert.equal(Object.isFrozen(invocation.env), true);
  }
});

test('metadata-only Git tools remain READ while using hardened execution', () => {
  for (const toolId of [
    'git.log',
    'git.branch.current',
    'git.root',
    'git.branch.list',
    'git.remote.list',
    'git.show',
  ]) {
    const args = toolId === 'git.log'
      ? ['5']
      : toolId === 'git.show'
        ? ['HEAD']
        : [];
    const invocation = resolveToolInvocation(toolId, args, root);
    assert.equal(invocation.risk, 'READ');
    assert.equal(requiresExplicitApproval(invocation.risk), false);
  }

  const show = resolveToolInvocation('git.show', ['HEAD'], root);
  assert.ok(show.args.includes('--no-ext-diff'));
  assert.ok(show.args.includes('--no-textconv'));
});
