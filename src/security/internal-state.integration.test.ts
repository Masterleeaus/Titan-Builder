import assert from 'node:assert/strict';
import { link, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import fs from 'fs-extra';
import {
  ensureMemory,
  listProjectMemory,
  writePromptFile,
} from '../memory/index.ts';
import {
  executePlannedOperations,
  planOperations,
} from '../operations/index.ts';

async function temporaryDirectory(t: TestContext, prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await fs.remove(directory);
  });
  return directory;
}

async function redirectDirectory(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

async function directoryEntries(directory: string): Promise<string[]> {
  return (await fs.readdir(directory)).sort();
}

test('memory initialization rejects a redirected .openbrowser root without touching outside state', async (t) => {
  const projectRoot = await temporaryDirectory(t, 'openbrowser-state-project-');
  const outsideRoot = await temporaryDirectory(t, 'openbrowser-state-outside-');
  await fs.writeFile(path.join(outsideRoot, 'sentinel.txt'), 'outside sentinel\n', 'utf8');
  await redirectDirectory(outsideRoot, path.join(projectRoot, '.openbrowser'));

  await assert.rejects(
    ensureMemory(projectRoot),
    /internal state|symbolic link|junction|redirect/i,
  );

  assert.deepEqual(await directoryEntries(outsideRoot), ['sentinel.txt']);
  assert.equal(
    await fs.readFile(path.join(outsideRoot, 'sentinel.txt'), 'utf8'),
    'outside sentinel\n',
  );
});

test('prompt writes reject a redirected nested state directory', async (t) => {
  const projectRoot = await temporaryDirectory(t, 'openbrowser-state-project-');
  const outsideRoot = await temporaryDirectory(t, 'openbrowser-state-outside-');
  await ensureMemory(projectRoot);
  await redirectDirectory(outsideRoot, path.join(projectRoot, '.openbrowser', 'prompts'));

  await assert.rejects(
    writePromptFile(projectRoot, 'session-safe', 'do not escape\n'),
    /internal state|symbolic link|junction|redirect/i,
  );

  assert.deepEqual(await directoryEntries(outsideRoot), []);
});

test('project memory rejects a hardlinked internal state file', async (t) => {
  const projectRoot = await temporaryDirectory(t, 'openbrowser-state-project-');
  const outsideRoot = await temporaryDirectory(t, 'openbrowser-state-outside-');
  await ensureMemory(projectRoot);
  const outsideFile = path.join(outsideRoot, 'outside-memory.json');
  const stateFile = path.join(projectRoot, '.openbrowser', 'memory.json');
  await fs.writeFile(outsideFile, '[]\n', 'utf8');
  await link(outsideFile, stateFile);

  await assert.rejects(
    listProjectMemory(projectRoot),
    /hardlink|link count|internal state|regular private file/i,
  );

  assert.equal(await fs.readFile(outsideFile, 'utf8'), '[]\n');
});

test('transaction preparation rejects a redirected .openbrowser root before project mutation', async (t) => {
  const projectRoot = await temporaryDirectory(t, 'openbrowser-state-project-');
  const outsideRoot = await temporaryDirectory(t, 'openbrowser-state-outside-');
  const targetPath = path.join(projectRoot, 'value.txt');
  await fs.writeFile(targetPath, 'before\n', 'utf8');
  const plans = await planOperations([
    { action: 'EDIT_FILE', path: 'value.txt', content: 'after\n' },
  ], projectRoot);
  await redirectDirectory(outsideRoot, path.join(projectRoot, '.openbrowser'));

  await assert.rejects(
    executePlannedOperations(plans, projectRoot),
    /internal state|symbolic link|junction|redirect/i,
  );

  assert.equal(await fs.readFile(targetPath, 'utf8'), 'before\n');
  assert.deepEqual(await directoryEntries(outsideRoot), []);
});

test('transaction preparation rejects a redirected transactions directory', async (t) => {
  const projectRoot = await temporaryDirectory(t, 'openbrowser-state-project-');
  const outsideRoot = await temporaryDirectory(t, 'openbrowser-state-outside-');
  const targetPath = path.join(projectRoot, 'value.txt');
  await fs.writeFile(targetPath, 'before\n', 'utf8');
  await fs.ensureDir(path.join(projectRoot, '.openbrowser'));
  await redirectDirectory(outsideRoot, path.join(projectRoot, '.openbrowser', 'transactions'));
  const plans = await planOperations([
    { action: 'EDIT_FILE', path: 'value.txt', content: 'after\n' },
  ], projectRoot);

  await assert.rejects(
    executePlannedOperations(plans, projectRoot),
    /internal state|symbolic link|junction|redirect/i,
  );

  assert.equal(await fs.readFile(targetPath, 'utf8'), 'before\n');
  assert.deepEqual(await directoryEntries(outsideRoot), []);
});

test('new internal state uses private directory and file permissions on POSIX', async (t) => {
  if (process.platform === 'win32') return;
  const projectRoot = await temporaryDirectory(t, 'openbrowser-state-project-');
  await ensureMemory(projectRoot);

  const rootMode = (await stat(path.join(projectRoot, '.openbrowser'))).mode & 0o777;
  const historyMode = (await stat(path.join(projectRoot, '.openbrowser', 'history.json'))).mode & 0o777;
  assert.equal(rootMode & 0o077, 0, `internal state root mode is ${rootMode.toString(8)}`);
  assert.equal(historyMode & 0o077, 0, `history mode is ${historyMode.toString(8)}`);
});
