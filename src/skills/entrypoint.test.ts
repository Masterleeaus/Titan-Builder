import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSkillEntrypoint } from './entrypoint.ts';

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

test('rejects traversal, absolute, Windows, encoded, and null-byte entrypoints', () => {
  for (const value of invalidEntrypoints) {
    assert.throws(() => parseSkillEntrypoint(value), /entrypoint/i, value);
  }
});

test('parses one portable contained module and export name', () => {
  assert.deepEqual(parseSkillEntrypoint('runtime/entrypoint.js#resolveProjectPath'), {
    modulePath: 'runtime/entrypoint.js',
    exportName: 'resolveProjectPath',
  });
});
