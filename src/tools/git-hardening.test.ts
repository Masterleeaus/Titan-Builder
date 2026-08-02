import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  listToolManifests,
  requiresExplicitApproval,
  resolveToolInvocation,
} from './registry.ts';
import type { ToolInvocation } from './types.ts';

const root = path.resolve('/tmp/project');

function manifest(runtimeId: string) {
  const value = listToolManifests().find((candidate) => candidate.runtimeId === runtimeId);
  assert.ok(value, `missing manifest for ${runtimeId}`);
  return value;
}

function gitArgs(invocation: ToolInvocation): string[] {
  assert.equal(invocation.executable, process.execPath);
  assert.equal(invocation.args[0], '--experimental-strip-types');
  assert.match(invocation.args[1] ?? '', /hardened-cli\.ts$/u);
  return invocation.args.slice(2);
}

test('worktree-sensitive Git tools require explicit arbitrary-execution approval', () => {
  const status = resolveToolInvocation('git.status', [], root);
  assert.equal(status.risk, 'ARBITRARY_EXECUTION');
  assert.equal(requiresExplicitApproval(status.risk), true);
  assert.deepEqual(gitArgs(status), ['status', '--short', '--branch']);
  assert.equal(manifest('git.status').risk, 'ARBITRARY_EXECUTION');
  assert.equal(manifest('git.status').approval, 'explicit');

  const diff = resolveToolInvocation('git.diff', ['--staged'], root);
  assert.equal(diff.risk, 'ARBITRARY_EXECUTION');
  assert.equal(requiresExplicitApproval(diff.risk), true);
  assert.deepEqual(gitArgs(diff), ['diff', '--no-ext-diff', '--no-textconv', '--staged']);
  assert.equal(manifest('git.diff').risk, 'ARBITRARY_EXECUTION');
  assert.equal(manifest('git.diff').approval, 'explicit');
});

test('every registered Git tool routes through the self-sanitising runner', () => {
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
    assert.equal(invocation.shell, false);
    assert.equal(invocation.executable, process.execPath);
    assert.equal(invocation.args[0], '--experimental-strip-types');
    assert.match(invocation.args[1] ?? '', /hardened-cli\.ts$/u);
    assert.match(invocation.displayCommand, /^git /u);
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
  const args = gitArgs(show);
  assert.ok(args.includes('--no-ext-diff'));
  assert.ok(args.includes('--no-textconv'));
});
