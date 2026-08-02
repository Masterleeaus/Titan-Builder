import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinToolRegistry, createToolRegistry } from './catalog.ts';
import { parseToolManifest } from './manifest.ts';
import type { BuiltinToolDefinition } from './types.ts';

test('built-in catalog is deterministic, immutable, and resolves canonical IDs', () => {
  const definitions = builtinToolRegistry.list();
  const ids = definitions.map((definition) => definition.manifest.runtimeId);

  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(builtinToolRegistry.canonicalId('git.status'), 'git.status');
  assert.equal(builtinToolRegistry.resolve('git.status')?.manifest.id, 'titan.tool.git.status');
  assert.equal(builtinToolRegistry.resolve('missing.tool'), undefined);
  assert.throws(() => {
    (definitions as unknown as BuiltinToolDefinition[]).push(definitions[0]!);
  }, TypeError);
});

test('catalog delegates invocation resolution to the registered trusted definition', () => {
  const definition = builtinToolRegistry.resolve('git.status');
  assert.ok(definition);

  const invocation = definition.resolve([], '/tmp/project');
  assert.equal(invocation.toolId, 'git.status');
  assert.equal(invocation.executable, 'git');
  assert.deepEqual(invocation.args, ['status', '--short', '--branch']);
});

test('catalog rejects duplicate runtime IDs', () => {
  const original = builtinToolRegistry.resolve('git.status');
  assert.ok(original);
  const duplicate: BuiltinToolDefinition = {
    ...original,
    manifest: parseToolManifest({
      ...original.manifest,
      id: 'titan.tool.git.status-duplicate',
    }),
  };

  assert.throws(
    () => createToolRegistry([original, duplicate]),
    /Duplicate tool runtime ID/u,
  );
});

test('catalog rejects aliases that collide with runtime IDs', () => {
  const status = builtinToolRegistry.resolve('git.status');
  const diff = builtinToolRegistry.resolve('git.diff');
  assert.ok(status);
  assert.ok(diff);

  const aliasCollision: BuiltinToolDefinition = {
    ...diff,
    manifest: parseToolManifest({
      ...diff.manifest,
      id: 'titan.tool.git.diff-alias-test',
      runtimeId: 'git.diff.alias-test',
      aliases: ['git.status'],
      examples: [{ title: 'Alias collision', tool: 'git.diff.alias-test', args: [] }],
    }),
  };

  assert.throws(
    () => createToolRegistry([status, aliasCollision]),
    /collides with a runtime ID|runtime ID collides with alias/u,
  );
});

test('catalog resolves declared aliases to their canonical runtime ID', () => {
  const status = builtinToolRegistry.resolve('git.status');
  assert.ok(status);
  const aliased: BuiltinToolDefinition = {
    ...status,
    manifest: parseToolManifest({
      ...status.manifest,
      id: 'titan.tool.git.status-aliased',
      runtimeId: 'git.status.aliased',
      aliases: ['git.state'],
      examples: [{ title: 'Read state', tool: 'git.state', args: [] }],
    }),
  };
  const registry = createToolRegistry([aliased]);

  assert.equal(registry.canonicalId('git.state'), 'git.status.aliased');
  assert.equal(registry.resolve('git.state'), aliased);
});
