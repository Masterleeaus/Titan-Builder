import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { addProjectMemory, listProjectMemory } from './project-memory.ts';

test('project memory respects retention bounds on add', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'memory-retention-'));
  try {
    await addProjectMemory(tempDir, 'Memory entry 1', ['test']);
    await addProjectMemory(tempDir, 'Memory entry 2', ['test']);

    const memory = await listProjectMemory(tempDir);
    assert(memory.length > 0, 'Should have memory entries after add');
    assert(memory.length <= 500, 'Memory should respect MAX_MEMORY_ENTRIES limit');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('project memory deduplicates and updates existing entries', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'memory-dedup-'));
  try {
    const first = await addProjectMemory(tempDir, 'Preserve Firefox support.', ['compat']);
    const second = await addProjectMemory(tempDir, 'preserve firefox support.', ['browser']);

    assert.equal(first.id, second.id, 'Should deduplicate normalized text');

    const memory = await listProjectMemory(tempDir);
    assert.equal(memory.length, 1, 'Should have exactly one entry after dedup');
    assert(memory[0]?.tags.includes('compat'), 'Should preserve first tag');
    assert(memory[0]?.tags.includes('browser'), 'Should add new tag');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
