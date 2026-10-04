import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { listToolManifests } from './registry.ts';
import { validateResolvedToolInvocation } from './validation.ts';
import type { ToolInvocation } from './types.ts';

const manifest = listToolManifests().find((candidate) => candidate.runtimeId === 'git.status');
assert.ok(manifest);

function validInvocation(): ToolInvocation {
  return {
    toolId: 'git.status',
    executable: process.execPath,
    args: ['--experimental-strip-types', 'hardened-runner.ts', 'status', '--short', '--branch'],
    cwd: path.resolve('/tmp/project'),
    risk: 'ARBITRARY_EXECUTION',
    displayCommand: 'git status --short --branch',
    shell: false,
  };
}

test('normalizes and freezes a resolved invocation that matches its manifest', () => {
  const input = validInvocation();
  const invocation = validateResolvedToolInvocation(manifest, input);

  assert.deepEqual(invocation, input);
  assert.notEqual(invocation, input);
  assert.equal(Object.isFrozen(invocation), true);
  assert.equal(Object.isFrozen(invocation.args), true);
});

test('rejects resolver output whose tool ID or risk drifts from the manifest', () => {
  assert.throws(
    () => validateResolvedToolInvocation(manifest, { ...validInvocation(), toolId: 'git.diff' }),
    /returned tool ID git\.diff but manifest requires git\.status/u,
  );
  assert.throws(
    () => validateResolvedToolInvocation(manifest, { ...validInvocation(), risk: 'PUBLISH' }),
    /returned risk PUBLISH but manifest requires ARBITRARY_EXECUTION/u,
  );
});

test('rejects shell execution, relative working directories, and malformed command data', () => {
  assert.throws(
    () => validateResolvedToolInvocation(manifest, { ...validInvocation(), shell: true } as unknown as ToolInvocation),
    /shell must be false/u,
  );
  assert.throws(
    () => validateResolvedToolInvocation(manifest, { ...validInvocation(), cwd: 'relative/path' }),
    /absolute working directory/u,
  );
  assert.throws(
    () => validateResolvedToolInvocation(manifest, { ...validInvocation(), executable: 'node\nunsafe' }),
    /executable/u,
  );
  assert.throws(
    () => validateResolvedToolInvocation(manifest, { ...validInvocation(), args: ['runner', 'bad\narg'] }),
    /argument 1/u,
  );
});
