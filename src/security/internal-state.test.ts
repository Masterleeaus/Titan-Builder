import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ensureOpenBrowserStateDirectory,
  resolveOpenBrowserStateFile,
} from './internal-state.ts';
import {
  addProjectMemory,
  saveContextSummary,
  writePromptFile,
} from '../memory/index.ts';

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

test('trusted state rejects a redirected .openbrowser root before any outside write', async () => {
  const fixture = await createFixture('openbrowser-state-root-');
  const sentinel = path.join(fixture.outside, 'sentinel.txt');
  await writeFile(sentinel, 'unchanged', 'utf8');
  await createDirectoryLink(fixture.outside, path.join(fixture.project, '.openbrowser'));

  try {
    await assert.rejects(
      ensureOpenBrowserStateDirectory(fixture.project),
      /openbrowser.*(?:symbolic link|junction|redirect|reparse)/i,
    );
    await assert.rejects(
      saveContextSummary(fixture.project, 'must not escape'),
      /openbrowser.*(?:symbolic link|junction|redirect|reparse)/i,
    );
    assert.equal(await readFile(sentinel, 'utf8'), 'unchanged');
    await assert.rejects(
      lstat(path.join(fixture.outside, 'context-summary.md')),
      { code: 'ENOENT' },
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('trusted state rejects a nested prompts redirect before writing prompt content', async () => {
  const fixture = await createFixture('openbrowser-state-prompts-');
  const stateRoot = path.join(fixture.project, '.openbrowser');
  await mkdir(stateRoot, { recursive: true });
  await createDirectoryLink(fixture.outside, path.join(stateRoot, 'prompts'));

  try {
    await assert.rejects(
      writePromptFile(fixture.project, 'session-1', 'secret prompt'),
      /prompts.*(?:symbolic link|junction|redirect|reparse)/i,
    );
    await assert.rejects(
      lstat(path.join(fixture.outside, 'session-1.txt')),
      { code: 'ENOENT' },
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('trusted state rejects a redirected memory file and preserves the outside target', async () => {
  const fixture = await createFixture('openbrowser-state-memory-');
  const stateRoot = path.join(fixture.project, '.openbrowser');
  const outsideMemory = path.join(fixture.outside, 'memory.json');
  await mkdir(stateRoot, { recursive: true });
  await writeFile(outsideMemory, '[]\n', 'utf8');
  await symlink(outsideMemory, path.join(stateRoot, 'memory.json'), 'file');

  try {
    await assert.rejects(
      addProjectMemory(fixture.project, 'must stay inside the project'),
      /memory\.json.*(?:symbolic link|redirect|hardlink|unsafe)/i,
    );
    assert.equal(await readFile(outsideMemory, 'utf8'), '[]\n');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('trusted state creates private real directories and resolves contained files', async () => {
  const fixture = await createFixture('openbrowser-state-valid-');

  try {
    const prompts = await ensureOpenBrowserStateDirectory(fixture.project, 'prompts');
    const promptFile = await resolveOpenBrowserStateFile(
      fixture.project,
      'prompts/session-2.txt',
    );

    assert.equal(prompts, path.join(fixture.project, '.openbrowser', 'prompts'));
    assert.equal(promptFile, path.join(prompts, 'session-2.txt'));
    assert.equal((await lstat(prompts)).isDirectory(), true);

    if (process.platform !== 'win32') {
      const mode = (await lstat(path.join(fixture.project, '.openbrowser'))).mode & 0o777;
      assert.equal(mode & 0o077, 0, 'trusted state root must not grant group/other access');
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
