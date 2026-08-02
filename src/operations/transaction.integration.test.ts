import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import fs from 'fs-extra';
import {
  executePlannedOperations,
  planOperations,
} from './index.ts';
import { listHistory } from '../memory/index.ts';

async function createProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openbrowser-transaction-'));
}

async function installSwapAndFailScript(projectRoot: string, outsideRoot: string): Promise<void> {
  const liveDirectory = path.join(projectRoot, 'safe');
  const displacedDirectory = path.join(projectRoot, 'safe-displaced');
  const script = [
    "const fs = require('node:fs');",
    `const liveDirectory = ${JSON.stringify(liveDirectory)};`,
    `const displacedDirectory = ${JSON.stringify(displacedDirectory)};`,
    `const outsideRoot = ${JSON.stringify(outsideRoot)};`,
    'fs.renameSync(liveDirectory, displacedDirectory);',
    "fs.symlinkSync(outsideRoot, liveDirectory, process.platform === 'win32' ? 'junction' : 'dir');",
    'process.exit(1);',
    '',
  ].join('\n');

  await writeFile(path.join(projectRoot, 'swap-and-fail.cjs'), script, 'utf8');
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node swap-and-fail.cjs' } }),
    'utf8',
  );
}

test('planning simulates earlier file operations before calculating later diffs', async () => {
  const projectRoot = await createProject();
  try {
    const plans = await planOperations([
      { action: 'CREATE_FILE', path: 'src/value.txt', content: 'one\n' },
      { action: 'EDIT_FILE', path: 'src/value.txt', search: 'one', replace: 'two' },
    ], projectRoot);

    assert.equal(plans.length, 2);
    assert.match(plans[0]?.diff ?? '', /\+one/);
    assert.match(plans[1]?.diff ?? '', /-one/);
    assert.match(plans[1]?.diff ?? '', /\+two/);
    assert.equal(await fs.pathExists(path.join(projectRoot, 'src/value.txt')), false);
  } finally {
    await fs.remove(projectRoot);
  }
});

test('execution rejects an approved plan when a file changes after preview', async () => {
  const projectRoot = await createProject();
  const filePath = path.join(projectRoot, 'existing.txt');
  await writeFile(filePath, 'before\n', 'utf8');
  try {
    const plans = await planOperations([
      { action: 'EDIT_FILE', path: 'existing.txt', content: 'after\n' },
    ], projectRoot);
    await writeFile(filePath, 'changed elsewhere\n', 'utf8');

    await assert.rejects(
      executePlannedOperations(plans, projectRoot),
      /precondition changed/i,
    );
    assert.equal(await readFile(filePath, 'utf8'), 'changed elsewhere\n');
  } finally {
    await fs.remove(projectRoot);
  }
});

test('a failed multi-file transaction restores earlier mutations and records rollback status', async () => {
  const projectRoot = await createProject();
  const firstPath = path.join(projectRoot, 'first.txt');
  const secondPath = path.join(projectRoot, 'second.txt');
  await writeFile(firstPath, 'before first\n', 'utf8');
  await writeFile(secondPath, 'before second\n', 'utf8');
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }),
    'utf8',
  );

  try {
    const plans = await planOperations([
      { action: 'EDIT_FILE', path: 'first.txt', content: 'after first\n' },
      { action: 'EDIT_FILE', path: 'second.txt', content: 'after second\n' },
      { action: 'RUN_TOOL', tool: 'npm.test' },
    ], projectRoot);

    await assert.rejects(
      executePlannedOperations(plans, projectRoot),
      /Operation transaction failed/i,
    );
    assert.equal(await readFile(firstPath, 'utf8'), 'before first\n');
    assert.equal(await readFile(secondPath, 'utf8'), 'before second\n');

    const history = await listHistory(projectRoot);
    const entry = history.at(-1);
    assert.equal(entry?.status, 'failed');
    assert.equal(entry?.rollbackStatus, 'rolled_back');

    const transactionDirectory = path.join(projectRoot, '.openbrowser', 'transactions');
    const transactionEntries = await fs.readdir(transactionDirectory);
    const journals = transactionEntries.filter((name) => name.endsWith('.json'));
    const backups = transactionEntries.filter((name) => name.endsWith('.backup'));
    assert.equal(journals.length, 1);
    assert.deepEqual(backups, []);
    const journal = await fs.readJson(path.join(transactionDirectory, journals[0] ?? '')) as {
      status?: string;
      rollbackStatus?: string;
      externalEffectsPossible?: boolean;
    };
    assert.equal(journal.status, 'rolled_back');
    assert.equal(journal.rollbackStatus, 'rolled_back');
    assert.equal(journal.externalEffectsPossible, true);
  } finally {
    await fs.remove(projectRoot);
  }
});

test('rollback stops before following a parent swapped to a symlink or junction', async () => {
  const projectRoot = await createProject();
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openbrowser-rollback-outside-'));
  const safeDirectory = path.join(projectRoot, 'safe');
  const displacedDirectory = path.join(projectRoot, 'safe-displaced');
  await fs.ensureDir(safeDirectory);
  await writeFile(path.join(safeDirectory, 'restore.txt'), 'project before\n', 'utf8');
  await writeFile(path.join(outsideRoot, 'restore.txt'), 'outside restore sentinel\n', 'utf8');
  await writeFile(path.join(outsideRoot, 'remove.txt'), 'outside remove sentinel\n', 'utf8');
  await installSwapAndFailScript(projectRoot, outsideRoot);

  try {
    const plans = await planOperations([
      { action: 'EDIT_FILE', path: 'safe/restore.txt', content: 'project after\n' },
      { action: 'CREATE_FILE', path: 'safe/remove.txt', content: 'project created\n' },
      { action: 'RUN_TOOL', tool: 'npm.test' },
    ], projectRoot);

    await assert.rejects(
      executePlannedOperations(plans, projectRoot),
      /Rollback failed/i,
    );

    assert.equal(
      await readFile(path.join(outsideRoot, 'restore.txt'), 'utf8'),
      'outside restore sentinel\n',
    );
    assert.equal(
      await readFile(path.join(outsideRoot, 'remove.txt'), 'utf8'),
      'outside remove sentinel\n',
    );
    assert.equal(
      await readFile(path.join(displacedDirectory, 'restore.txt'), 'utf8'),
      'project after\n',
    );
    assert.equal(
      await readFile(path.join(displacedDirectory, 'remove.txt'), 'utf8'),
      'project created\n',
    );

    const transactionDirectory = path.join(projectRoot, '.openbrowser', 'transactions');
    const transactionEntries = await fs.readdir(transactionDirectory);
    const journals = transactionEntries.filter((name) => name.endsWith('.json'));
    const backups = transactionEntries.filter((name) => name.endsWith('.backup'));
    assert.equal(journals.length, 1);
    assert.equal(backups.length, 1, 'rollback evidence must remain quarantined');

    const journal = await fs.readJson(path.join(transactionDirectory, journals[0] ?? '')) as {
      status?: string;
      rollbackStatus?: string;
      error?: string;
    };
    assert.equal(journal.status, 'rollback_failed');
    assert.equal(journal.rollbackStatus, 'rollback_failed');
    assert.match(journal.error ?? '', /symbolic link|junction|contain|project path/i);
  } finally {
    await fs.remove(projectRoot);
    await fs.remove(outsideRoot);
  }
});

test('planner rejects writes through an intermediate symlink that leaves the project', async () => {
  const projectRoot = await createProject();
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openbrowser-outside-'));
  const linkPath = path.join(projectRoot, 'linked');
  try {
    await fs.symlink(outsideRoot, linkPath, 'dir');
    await assert.rejects(
      planOperations([
        { action: 'CREATE_FILE', path: 'linked/escape.txt', content: 'blocked\n' },
      ], projectRoot),
      /outside project root|symbolic link/i,
    );
    assert.equal(await fs.pathExists(path.join(outsideRoot, 'escape.txt')), false);
  } finally {
    await fs.remove(projectRoot);
    await fs.remove(outsideRoot);
  }
});

test('executor detects a symlink swap between preview and write', async () => {
  if (process.platform === 'win32') return;
  const projectRoot = await createProject();
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openbrowser-outside-'));
  const safeDirectory = path.join(projectRoot, 'safe');
  await fs.ensureDir(safeDirectory);
  try {
    const plans = await planOperations([
      { action: 'CREATE_FILE', path: 'safe/value.txt', content: 'blocked\n' },
    ], projectRoot);
    await fs.remove(safeDirectory);
    await fs.symlink(outsideRoot, safeDirectory, 'dir');

    await assert.rejects(
      executePlannedOperations(plans, projectRoot),
      /outside project root|symbolic link|precondition/i,
    );
    assert.equal(await fs.pathExists(path.join(outsideRoot, 'value.txt')), false);
  } finally {
    await fs.remove(projectRoot);
    await fs.remove(outsideRoot);
  }
});

test('existing project root is canonical before planning starts', async () => {
  const projectRoot = await createProject();
  try {
    const canonicalRoot = await realpath(projectRoot);
    assert.equal(path.isAbsolute(canonicalRoot), true);
    assert.equal(path.basename(canonicalRoot), path.basename(projectRoot));
    const plans = await planOperations([
      { action: 'CREATE_FOLDER', path: 'src' },
    ], canonicalRoot);
    assert.equal(plans.length, 1);
  } finally {
    await fs.remove(projectRoot);
  }
});
