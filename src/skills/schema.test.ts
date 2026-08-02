import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface SkillManifestJsonSchema {
  properties?: {
    entrypoint?: {
      pattern?: string;
    };
  };
}

async function loadEntrypointPattern(): Promise<RegExp> {
  const schemaUrl = new URL('./titan-skill-manifest.schema.json', import.meta.url);
  const schema = JSON.parse(await readFile(schemaUrl, 'utf8')) as SkillManifestJsonSchema;
  const pattern = schema.properties?.entrypoint?.pattern;
  assert.equal(typeof pattern, 'string', 'JSON Schema must declare an entrypoint pattern.');
  return new RegExp(pattern, 'u');
}

test('published JSON Schema rejects unsafe skill entrypoints', async () => {
  const pattern = await loadEntrypointPattern();
  const invalidEntrypoints = [
    '../module.js#handler',
    './module.js#handler',
    '/tmp/module.js#handler',
    'C:/tmp/module.js#handler',
    'C:\\tmp\\module.js#handler',
    '\\\\server\\share\\module.js#handler',
    'folder\\module.js#handler',
    'folder/%2e%2e/module.js#handler',
    'folder%2fmodule.js#handler',
    'folder%5cmodule.js#handler',
    'module.js%23other#handler',
    'module.js#handler\0tail',
  ];

  for (const entrypoint of invalidEntrypoints) {
    assert.equal(pattern.test(entrypoint), false, entrypoint);
  }
});

test('published JSON Schema accepts a portable contained skill entrypoint', async () => {
  const pattern = await loadEntrypointPattern();
  assert.equal(pattern.test('runtime/entrypoint.js#resolveProjectPath'), true);
});
