import assert from 'node:assert/strict';
import test from 'node:test';

import type { FileOperation } from '../core/types/index.ts';
import { preserveOperationOrder } from './operation-order.ts';

function actions(operations: FileOperation[]): string[] {
  return operations.map((operation) => `${operation.action}:${operation.path ?? operation.tool ?? ''}`);
}

test('preserves rename then edit dependency order', () => {
  const operations: FileOperation[] = [
    { action: 'RENAME_FILE', path: 'old.txt', replace: 'new.txt' },
    { action: 'EDIT_FILE', path: 'new.txt', content: 'updated' },
  ];

  assert.deepEqual(actions(preserveOperationOrder(operations)), actions(operations));
});

test('preserves delete then recreate final-state order', () => {
  const operations: FileOperation[] = [
    { action: 'DELETE_FILE', path: 'same.txt' },
    { action: 'CREATE_FILE', path: 'same.txt', content: 'replacement' },
  ];

  assert.deepEqual(actions(preserveOperationOrder(operations)), actions(operations));
});

test('preserves create before the tool that consumes it', () => {
  const operations: FileOperation[] = [
    { action: 'CREATE_FILE', path: 'generated.json', content: '{}' },
    { action: 'RUN_TOOL', tool: 'npm.run', args: ['test'] },
  ];

  assert.deepEqual(actions(preserveOperationOrder(operations)), actions(operations));
});

test('preserves repeated edits in declared sequence', () => {
  const operations: FileOperation[] = [
    { action: 'EDIT_FILE', path: 'app.ts', search: 'one', replace: 'two' },
    { action: 'EDIT_FILE', path: 'app.ts', search: 'two', replace: 'three' },
  ];

  assert.deepEqual(actions(preserveOperationOrder(operations)), actions(operations));
});

test('returns a new array without mutating the declared plan', () => {
  const operations: FileOperation[] = [
    { action: 'RUN_TOOL', tool: 'git.status' },
    { action: 'CREATE_FOLDER', path: 'src' },
  ];
  const result = preserveOperationOrder(operations);

  assert.notEqual(result, operations);
  assert.deepEqual(result, operations);
});
