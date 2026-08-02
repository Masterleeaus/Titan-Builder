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

test('post-commit history failure never rolls back applied changes', async () => {
  const projectRoot = await createProject();
  const targetPath = path.join(projectRoot, 'value.txt');
  const historyPath = path.join(projectRoot, '.openbrowser', 'history.json');
  await writeFile(targetPath, 'before\n', 'utf8');
  await fs.ensureDir(path.dirname(historyPath));
  await writeFile(historyPath, '{malformed history', 'utf8');

  try {
    const plans = await planOperations([
      { action: 'EDIT_FILE', path: 'value.txt', content: 'after\n' },
    ], projectRoot);

    await assert.rejects(
      executePlannedOperations(plans, projectRoot),
      /committed, but post-commit finalization failed.*not rolled back/i,
    );

    assert.equal(await readFile(targetPath, 'utf8'), 'after\n');
    assert.equal(await readFile(historyPath, 'utf8'), '{malformed history');

    const transactionDirectory = path.join(projectRoot, '.openbrowser', 'transactions');
    const entries = await fs.readdir(transactionDirectory);
    const journalName = entries.find((name) => name.endsWith('.json'));
    assert.ok(journalName);
    assert.ok(
      entries.some((name) => name.endsWith('.backup')),
      'post-commit history failure preserves backup evidence for diagnosis',
    );

    const journal = await fs.readJson(path.join(transactionDirectory, journalName)) as {
      status?: string;
      rollbackStatus?: string;
      error?: string;
    };
    assert.equal(journal.status, 'committed');
    assert.equal(journal.rollbackStatus, 'not_required');
    assert.match(journal.error ?? '', /committed.*finalization failed/i);
  } finally {
    await fs.remove(projectRoot);
  }
});

test('rollback fails closed when a target parent is replaced by an outside symlink or junction', async () => {
  const projectRoot = await createProject();
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openbrowser-rollback-outside-'));
  const safeDirectory = path.join(projectRoot, 'safe');
  const originalDirectory = path.join(projectRoot, 'safe-original');
  const targetPath = path.join(safeDirectory, 'value.txt');
  const outsideTarget = path.join(outsideRoot, 'value.txt');
  const swapScript = path.join(projectRoot, 'swap-parent-and-fail.cjs');

  await fs.ensureDir(safeDirectory);
  await writeFile(targetPath, 'before\n', 'utf8');
  await writeFile(outsideTarget, 'outside sentinel\n', 'utf8');
  await writeFile(
    swapScript,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const projectRoot = process.cwd();',
      "const safeDirectory = path.join(projectRoot, 'safe');",
      "const originalDirectory = path.join(projectRoot, 'safe-original');",
      'fs.renameSync(safeDirectory, originalDirectory);',
      `fs.symlinkSync(${JSON.stringify(outsideRoot)}, safeDirectory, process.platform === 'win32' ? 'junction' : 'dir');`,
      'process.exit(1);',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node swap-parent-and-fail.cjs' } }),
    'utf8',
  );

  try {
    const plans = await planOperations([
      { action: 'EDIT_FILE', path: 'safe/value.txt', content: 'after\n' },
      { action: 'RUN_TOOL', tool: 'npm.test' },
    ], projectRoot);

    await assert.rejects(
      executePlannedOperations(plans, projectRoot),
      /rollback failed/i,
    );

    assert.equal(await readFile(outsideTarget, 'utf8'), 'outside sentinel\n');
    assert.equal(await readFile(path.join(originalDirectory, 'value.txt'), 'utf8'), 'after\n');

    const transactionDirectory = path.join(projectRoot, '.openbrowser', 'transactions');
    const entries = await fs.readdir(transactionDirectory);
    const journalName = entries.find((name) => name.endsWith('.json'));
    const backupName = entries.find((name) => name.endsWith('.backup'));
    assert.ok(journalName);
    assert.ok(backupName, 'failed rollback keeps backup evidence quarantined');

    const journal = await fs.readJson(path.join(transactionDirectory, journalName)) as {
      status?: string;
      rollbackStatus?: string;
      error?: string;
    };
    assert.equal(journal.status, 'rollback_failed');
    assert.equal(journal.rollbackStatus, 'rollback_failed');
    assert.match(journal.error ?? '', /symbolic link|junction|rollback path/i);
  } finally {
    await fs.remove(projectRoot);
    await fs.remove(outsideRoot);
  }
});

test('rollback rejects a backup replaced by a symbolic link before restoring any target', async () => {
  if (process.platform === 'win32') return;

  const projectRoot = await createProject();
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openbrowser-rollback-backup-'));
  const targetPath = path.join(projectRoot, 'value.txt');
  const poisonPath = path.join(outsideRoot, 'poison.txt');
  const poisonScript = path.join(projectRoot, 'poison-backups-and-fail.cjs');

  await writeFile(targetPath, 'before\n', 'utf8');
  await writeFile(poisonPath, 'poison\n', 'utf8');
  await writeFile(
    poisonScript,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const transactionsRoot = path.join(process.cwd(), '.openbrowser', 'transactions');",
      "const backupDirectory = fs.readdirSync(transactionsRoot).find((name) => name.endsWith('.backup'));",
      "if (!backupDirectory) throw new Error('backup directory not found');",
      'const backupRoot = path.join(transactionsRoot, backupDirectory);',
      "for (const name of fs.readdirSync(backupRoot).filter((entry) => entry.endsWith('.bak'))) {",
      '  const backupPath = path.join(backupRoot, name);',
      '  fs.unlinkSync(backupPath);',
      `  fs.symlinkSync(${JSON.stringify(poisonPath)}, backupPath, 'file');`,
      '}',
      'process.exit(1);',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node poison-backups-and-fail.cjs' } }),
    'utf8',
  );

  try {
    const plans = await planOperations([
      { action: 'EDIT_FILE', path: 'value.txt', content: 'after\n' },
      { action: 'RUN_TOOL', tool: 'npm.test' },
    ], projectRoot);

    await assert.rejects(
      executePlannedOperations(plans, projectRoot),
      /rollback failed/i,
    );

    assert.equal(await readFile(targetPath, 'utf8'), 'after\n');
    assert.equal(await readFile(poisonPath, 'utf8'), 'poison\n');

    const transactionDirectory = path.join(projectRoot, '.openbrowser', 'transactions');
    const entries = await fs.readdir(transactionDirectory);
    const journalName = entries.find((name) => name.endsWith('.json'));
    const backupName = entries.find((name) => name.endsWith('.backup'));
    assert.ok(journalName);
    assert.ok(backupName, 'failed rollback keeps backup evidence quarantined');

    const journal = await fs.readJson(path.join(transactionDirectory, journalName)) as {
      status?: string;
      rollbackStatus?: string;
      error?: string;
    };
    assert.equal(journal.status, 'rollback_failed');
    assert.equal(journal.rollbackStatus, 'rollback_failed');
    assert.match(journal.error ?? '', /symbolic link|rollback backup|rollback path/i);
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
