import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addProjectMemory,
  clearProjectMemory,
  formatProjectMemory,
  listProjectMemory,
  removeProjectMemory,
} from './project-memory.ts';

test('adds, normalizes, and deduplicates project memory', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openbrowser-memory-'));
  const first = await addProjectMemory(root, '  Preserve Firefox support.  ', ['compatibility', 'browser']);
  const second = await addProjectMemory(root, 'preserve firefox support.', ['release']);
  const entries = await listProjectMemory(root);

  assert.equal(first.id, second.id);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0]?.tags, ['browser', 'compatibility', 'release']);
  assert.equal(entries[0]?.text, 'Preserve Firefox support.');
});

test('removes and clears project memory safely', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openbrowser-memory-'));
  const one = await addProjectMemory(root, 'One decision');
  await addProjectMemory(root, 'Two decisions');

  assert.equal(await removeProjectMemory(root, one.id), true);
  assert.equal((await listProjectMemory(root)).length, 1);
  await clearProjectMemory(root);
  assert.equal((await listProjectMemory(root)).length, 0);
});

test('formats memory as explicit prompt context', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openbrowser-memory-'));
  await addProjectMemory(root, 'Never weaken CSP.', ['security']);
  const formatted = formatProjectMemory(await listProjectMemory(root));

  assert.match(formatted, /OpenBrowser Project Memory/);
  assert.match(formatted, /Never weaken CSP\./);
  assert.match(formatted, /security/);
});
