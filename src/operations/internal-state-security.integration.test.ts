import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeOperations } from './index.ts';
import { openProjectInternalState } from '../security/internal-state.ts';

async function createDirectoryLink(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

async function createFixture(prefix: string): Promise<{
  root: string;
  project: string;
  outside: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const project = path.join(root, 'project');
  const outside = path.join(root, 'outside');
  await Promise.all([
    mkdir(project, { recursive: true }),
    mkdir(outside, { recursive: true }),
  ]);
  return { root, project, outside };
}

test('transaction preparation rejects a redirected transactions root before mutation or outside writes', async () => {
  const fixture = await createFixture('openbrowser-transaction-state-');
  const target = path.join(fixture.project, 'tracked.txt');
  const sentinel = path.join(fixture.outside, 'sentinel.txt');
  const stateRoot = path.join(fixture.project, '.openbrowser');
  await Promise.all([
    writeFile(target, 'original', 'utf8'),
    writeFile(sentinel, 'unchanged', 'utf8'),
    mkdir(stateRoot, { recursive: true }),
  ]);
  await createDirectoryLink(fixture.outside, path.join(stateRoot, 'transactions'));

  try {
    await assert.rejects(
      executeOperations(
        [{ action: 'EDIT_FILE', path: 'tracked.txt', content: 'changed' }],
        fixture.project,
      ),
      /transactions.*(?:symbolic link|junction|redirect|reparse)/i,
    );

    assert.equal(await readFile(target, 'utf8'), 'original');
    assert.equal(await readFile(sentinel, 'utf8'), 'unchanged');
    assert.deepEqual(await readdir(fixture.outside), ['sentinel.txt']);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('transaction backup cleanup rejects a nested redirected backup directory', async () => {
  const fixture = await createFixture('openbrowser-transaction-cleanup-');
  const state = await openProjectInternalState(fixture.project);
  await state.ensureDirectory('transactions');
  await createDirectoryLink(
    fixture.outside,
    path.join(state.stateRoot, 'transactions', 'run.backup'),
  );

  try {
    await assert.rejects(
      state.removeTree('transactions/run.backup'),
      /cleanup.*(?:symbolic link|junction|redirect|reparse)/i,
    );
    assert.deepEqual(await readdir(fixture.outside), []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
