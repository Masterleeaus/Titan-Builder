import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import fs from 'fs-extra';

import { executeOperations, planOperations } from './index.js';

async function createProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'openbrowser-operations-'));
}

test('planning simulates earlier file operations before calculating later diffs', async () => {
  const projectRoot = await createProject();
  const filePath = path.join(projectRoot, 'notes.txt');
  await writeFile(filePath, 'one\n', 'utf8');

  try {
    const plans = await planOperations([
      { action: 'EDIT_FILE', path: 'notes.txt', search: 'one', replace: 'two' },
      { action: 'EDIT_FILE', path: 'notes.txt', search: 'two', replace: 'three' },
    ], projectRoot);

    assert.equal(plans.length, 2);
    assert.match(plans[0]?.diff ?? '', /-one/);
    assert.match(plans[0]?.diff ?? '', /\+two/);
    assert.match(plans[1]?.diff ?? '', /-two/);
    assert.match(plans[1]?.diff ?? '', /\+three/);
    assert.doesNotMatch(plans[1]?.diff ?? '', /-one/);
  } finally {
    await fs.remove(projectRoot);
  }
});

test('a failed multi-file transaction restores earlier mutations and records rollback status', async () => {
  const projectRoot = await createProject();
  const firstPath = path.join(projectRoot, 'first.txt');
  const sourcePath = path.join(projectRoot, 'source.txt');
  const occupiedPath = path.join(projectRoot, 'occupied.txt');
  await writeFile(firstPath, 'original\n', 'utf8');
  await writeFile(sourcePath, 'source\n', 'utf8');
  await writeFile(occupiedPath, 'occupied\n', 'utf8');

  try {
    await assert.rejects(
      executeOperations([
        { action: 'EDIT_FILE', path: 'first.txt', content: 'changed\n' },
        { action: 'RENAME_FILE', path: 'source.txt', replace: 'occupied.txt' },
      ], projectRoot, { conversationId: 'rollback-test' }),
      /rollback/i,
    );

    assert.equal(await readFile(firstPath, 'utf8'), 'original\n');
    assert.equal(await readFile(sourcePath, 'utf8'), 'source\n');
    assert.equal(await readFile(occupiedPath, 'utf8'), 'occupied\n');

    const history = await fs.readJson(path.join(projectRoot, '.openbrowser', 'history.json')) as Array<{
      conversationId?: string;
      status?: string;
      rollbackStatus?: string;
    }>;
    const entry = history.at(-1);
    assert.equal(entry?.conversationId, 'rollback-test');
    assert.equal(entry?.status, 'failed');
    assert.equal(entry?.rollbackStatus, 'rolled_back');
  } finally {
    await fs.remove(projectRoot);
  }
});
