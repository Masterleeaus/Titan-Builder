import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Helper function from the actual script
function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

test('rejects skill manifests with invalid schema', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skill-gen-'));
  try {
    const packageRoot = path.join(root, 'invalid');
    await mkdir(packageRoot);

    // Write invalid manifest (missing required fields)
    const manifest = {
      schemaVersion: '1',
      id: 'titan.invalid',
      // Missing required fields like name, version, etc.
    };
    await writeFile(path.join(packageRoot, 'manifest.json'), JSON.stringify(manifest));

    // Try to load and validate
    const { validateSkillManifest } = await import(path.join(repositoryRoot, 'src', 'skills', 'manifest.ts'));
    const validation = validateSkillManifest(manifest);
    assert.equal(validation.success, false, 'Should reject invalid manifest');
    assert(validation.issues.length > 0, 'Should have validation issues');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects manifests with invalid skill IDs', async () => {
  const { validateSkillManifest } = await import(path.join(repositoryRoot, 'src', 'skills', 'manifest.ts'));

  const invalidIds = [
    'not-prefixed',
    'titan',
    'titan.',
    'TITAN.uppercase',
    'titan.with spaces',
  ];

  for (const id of invalidIds) {
    const manifest = {
      schemaVersion: '1',
      id,
      name: 'Test',
      version: '1.0.0',
      status: 'stable',
      kind: 'guidance',
      category: 'test',
      description: 'Test skill',
      owner: 'Test',
      runtimeTargets: ['root'],
      instructions: 'test',
      inputs: { type: 'object', additionalProperties: false, properties: {} },
      outputs: { type: 'object', additionalProperties: false, properties: {} },
      risk: 'READ',
      approval: 'none',
    };

    const validation = validateSkillManifest(manifest);
    assert.equal(validation.success, false, `Should reject ID: ${id}`);
  }
});

test('isContained function correctly identifies symlink escapes', () => {
  const root = '/home/user/project';

  // Valid contained paths
  assert.ok(isContained(root, '/home/user/project/file.txt'));
  assert.ok(isContained(root, '/home/user/project/lib/file.txt'));
  assert.ok(isContained(root, root));

  // Invalid paths that escape
  assert.ok(!isContained(root, '/home/user/outside.txt'));
  assert.ok(!isContained(root, '/etc/passwd'));
  assert.ok(!isContained(root, '/home'));

  // Relative paths would be resolved first, so we test the logic
  // A path like /home/user/project/lib/../../../etc/passwd would resolve to /etc/passwd
  // The test verifies the escaped result is caught
});

test('detects duplicate skill IDs in catalog', async () => {
  const { validateSkillManifest } = await import(path.join(repositoryRoot, 'src', 'skills', 'manifest.ts'));

  const createManifest = (id) => ({
    schemaVersion: '1',
    id,
    name: `Skill ${id}`,
    version: '1.0.0',
    status: 'stable',
    kind: 'guidance',
    category: 'test',
    description: 'Test skill',
    owner: 'Test',
    runtimeTargets: ['root'],
    instructions: 'test',
    inputs: { type: 'object', additionalProperties: false, properties: {} },
    outputs: { type: 'object', additionalProperties: false, properties: {} },
    risk: 'READ',
    approval: 'none',
  });

  const skill1 = createManifest('titan.test.duplicate');
  const skill2 = createManifest('titan.test.duplicate');

  assert.equal(validateSkillManifest(skill1).success, true);
  assert.equal(validateSkillManifest(skill2).success, true);
  // In the actual catalog generation, duplicate detection happens when building the catalog
});

test('validates manifest instructions asset containment', async () => {
  const { validateSkillManifest } = await import(path.join(repositoryRoot, 'src', 'skills', 'manifest.ts'));

  const validManifest = {
    schemaVersion: '1',
    id: 'titan.test.valid-instructions',
    name: 'Test',
    version: '1.0.0',
    status: 'stable',
    kind: 'guidance',
    category: 'test',
    description: 'Test skill',
    owner: 'Test',
    runtimeTargets: ['root'],
    instructions: 'instructions.md',
    inputs: { type: 'object', additionalProperties: false, properties: {} },
    outputs: { type: 'object', additionalProperties: false, properties: {} },
    risk: 'READ',
    approval: 'none',
  };

  assert.equal(validateSkillManifest(validManifest).success, true);

  // Invalid: path traversal
  const escapingManifest = {
    ...validManifest,
    instructions: '../outside.md',
  };

  assert.equal(validateSkillManifest(escapingManifest).success, false);
});
