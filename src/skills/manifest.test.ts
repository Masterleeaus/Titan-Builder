import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSkillManifest, validateSkillManifest } from './manifest.ts';

const guidanceManifest = {
  schemaVersion: '1',
  id: 'titan.guidance.systematic-debugging',
  name: 'Systematic Debugging',
  version: '1.0.0',
  status: 'stable',
  kind: 'guidance',
  category: 'quality',
  description: 'Trace evidence and isolate root cause before editing.',
  owner: 'Titan Builder',
  runtimeTargets: ['extension-sidepanel'],
  instructions: 'instructions.md',
  inputs: { type: 'object', additionalProperties: false, properties: {} },
  outputs: { type: 'object', additionalProperties: false, properties: {} },
  dependencies: [],
  capabilities: [],
  risk: 'READ',
  approval: 'none',
  tags: ['debugging', 'root-cause'],
  aliases: ['debugging'],
};

test('accepts a strict guidance manifest', () => {
  assert.deepEqual(parseSkillManifest(guidanceManifest), guidanceManifest);
});

test('requires executable skills to declare an entrypoint', () => {
  const result = validateSkillManifest({
    ...guidanceManifest,
    id: 'titan.security.project-path-containment',
    kind: 'executable',
    runtimeTargets: ['root'],
    instructions: undefined,
  });
  assert.equal(result.success, false);
  assert.match(result.issues.map((issue) => issue.message).join('\n'), /entrypoint/i);
});

test('requires approval for high-side-effect risk', () => {
  const result = validateSkillManifest({
    ...guidanceManifest,
    risk: 'DESTRUCTIVE',
    approval: 'none',
  });
  assert.equal(result.success, false);
  assert.match(result.issues.map((issue) => issue.message).join('\n'), /approval/i);
});

test('rejects undeclared manifest fields', () => {
  const result = validateSkillManifest({ ...guidanceManifest, surprise: true });
  assert.equal(result.success, false);
  assert.match(
    result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'),
    /surprise/i,
  );
});
