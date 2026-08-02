import assert from 'node:assert/strict';
import test from 'node:test';
import { tryExpandMkdirCommand } from './mkdir-normalize.ts';

test('expands commands containing only safe folder creation', () => {
  assert.deepEqual(tryExpandMkdirCommand('mkdir src/tools && mkdir tests/tools'), [
    { action: 'CREATE_FOLDER', path: 'src/tools' },
    { action: 'CREATE_FOLDER', path: 'tests/tools' },
  ]);
});

test('does not split mixed shell commands into partially trusted operations', () => {
  assert.equal(tryExpandMkdirCommand('mkdir generated && npm test'), null);
});
