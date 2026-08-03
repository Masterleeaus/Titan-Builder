import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSkillRegistry } from './registry.ts';

const manifest = (id: string, aliases: string[] = [], instructions = 'instructions.md') => ({
  schemaVersion: '1',
  id,
  name: id,
  version: '1.0.0',
  status: 'stable',
  kind: 'guidance',
  category: 'quality',
  description: `Description for ${id}`,
  owner: 'Titan Builder',
  runtimeTargets: ['extension-sidepanel'],
  instructions,
  inputs: { type: 'object', additionalProperties: false, properties: {} },
  outputs: { type: 'object', additionalProperties: false, properties: {} },
  dependencies: [],
  capabilities: [],
  risk: 'READ',
  approval: 'none',
  tags: ['test'],
  aliases,
});

const executableManifest = (entrypoint = 'runtime/entrypoint.js#resolveProjectPath') => ({
  ...manifest('titan.security.project-path-containment'),
  name: 'Project Path Containment',
  kind: 'executable',
  runtimeTargets: ['root'],
  instructions: undefined,
  entrypoint,
  aliases: undefined,
});

async function writePackage(root: string, folder: string, value: object, instructions = 'Use evidence.') {
  const packageRoot = path.join(root, folder);
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, 'manifest.json'), JSON.stringify(value, null, 2));
  await writeFile(path.join(packageRoot, 'instructions.md'), instructions);
  return packageRoot;
}

async function writeExecutablePackage(
  root: string,
  folder: string,
  value = executableManifest(),
): Promise<string> {
  const packageRoot = path.join(root, folder);
  await mkdir(path.join(packageRoot, 'runtime'), { recursive: true });
  await writeFile(path.join(packageRoot, 'manifest.json'), JSON.stringify(value, null, 2));
  await writeFile(
    path.join(packageRoot, 'runtime', 'entrypoint.js'),
    'export function resolveProjectPath() { throw new Error("Use the closed dispatcher."); }\n',
  );
  return packageRoot;
}

test('discovers packages deterministically and resolves legacy aliases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'titan-skills-'));
  try {
    await writePackage(root, 'z-last', manifest('titan.guidance.testing', ['testing']), 'Test first.');
    await writePackage(root, 'a-first', manifest('titan.guidance.debugging', ['debugging']), 'Trace first.');

    const registry = await loadSkillRegistry(root);

    assert.deepEqual(registry.list().map((skill) => skill.manifest.id), [
      'titan.guidance.debugging',
      'titan.guidance.testing',
    ]);
    assert.equal(registry.resolve('debugging')?.manifest.id, 'titan.guidance.debugging');
    assert.equal(registry.resolve('titan.guidance.debugging')?.instructions, 'Trace first.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects duplicate aliases across packages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'titan-skills-'));
  try {
    await writePackage(root, 'one', manifest('titan.guidance.one', ['shared']));
    await writePackage(root, 'two', manifest('titan.guidance.two', ['shared']));
    await assert.rejects(() => loadSkillRegistry(root), /alias.*shared/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects instruction paths that escape the package', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'titan-skills-'));
  try {
    await writePackage(root, 'escaped', manifest('titan.guidance.escaped', [], '../outside.md'));
    await writeFile(path.join(root, 'outside.md'), 'Do not load me.');
    await assert.rejects(
      () => loadSkillRegistry(root),
      /contained relative asset path|outside.*package|escape/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects entrypoint paths that escape the package', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'titan-skills-'));
  try {
    const execManifest = {
      ...manifest('titan.executable.escaped', [], undefined),
      kind: 'executable',
      runtimeTargets: ['root'],
      instructions: undefined,
      entrypoint: '../outside.js#execute',
    };
    await writePackage(root, 'escaped', execManifest, '');
    await writeFile(path.join(root, 'outside.js'), 'export function execute() {}');
    await assert.rejects(
      () => loadSkillRegistry(root),
      /relative module path|escape|boundary|traversal/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects entrypoint modules that do not exist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'titan-skills-'));
  try {
    const execManifest = {
      ...manifest('titan.executable.missing', [], undefined),
      kind: 'executable',
      runtimeTargets: ['root'],
      instructions: undefined,
      entrypoint: 'missing.js#execute',
    };
    await writePackage(root, 'missing', execManifest, '');
    await assert.rejects(
      () => loadSkillRegistry(root),
      /unable to resolve|not found/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('accepts valid executable entrypoint modules', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'titan-skills-'));
  try {
    const execManifest = {
      ...manifest('titan.executable.valid', [], undefined),
      kind: 'executable',
      runtimeTargets: ['root'],
      instructions: undefined,
      entrypoint: 'handler.js#execute',
    };
    await writePackage(root, 'valid', execManifest, '');
    await writeFile(path.join(root, 'valid', 'handler.js'), 'export function execute() {}');
    const registry = await loadSkillRegistry(root);
    const skill = registry.resolve('titan.executable.valid');
    assert(skill, 'Should load executable skill');
    assert(skill.entrypoint, 'Should have resolved entrypoint');
    assert.match(skill.entrypoint.modulePath, /handler\.js$/);
    assert.equal(skill.entrypoint.exportName, 'execute');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loads the canonical repository skill library and resolves all built-in aliases', async () => {
  const libraryRoot = path.resolve('browser-extension/skill-library/packages');
  const registry = await loadSkillRegistry(libraryRoot);

  assert.deepEqual(registry.list().map((skill) => skill.manifest.id), [
    'titan.guidance.architecture-review',
    'titan.guidance.browser-performance',
    'titan.guidance.extension-security',
    'titan.guidance.git-discipline',
    'titan.guidance.systematic-debugging',
    'titan.guidance.test-driven-development',
    'titan.security.project-path-containment',
  ]);
  assert.equal(registry.canonicalId('debugging'), 'titan.guidance.systematic-debugging');
  assert.equal(registry.canonicalId('testing'), 'titan.guidance.test-driven-development');
  assert.equal(registry.canonicalId('security'), 'titan.guidance.extension-security');
  assert.equal(registry.canonicalId('architecture'), 'titan.guidance.architecture-review');
  assert.equal(registry.canonicalId('git'), 'titan.guidance.git-discipline');
  assert.equal(registry.canonicalId('performance'), 'titan.guidance.browser-performance');
});
