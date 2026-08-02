import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import fs from 'fs-extra';
import {
  executePlannedOperations,
  planOperations,
} from './index.ts';

test('a project-root swap cannot redirect rollback failure metadata', async () => {
  if (process.platform === 'win32') return;

  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openbrowser-root-swap-'));
  const displacedRoot = `${projectRoot}-displaced`;
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openbrowser-root-swap-outside-'));
  const outsideMetadata = path.join(outsideRoot, '.openbrowser');
  const outsideTransactions = path.join(outsideMetadata, 'transactions');
  const outsideHistory = path.join(outsideMetadata, 'history.json');
  const outsideSentinel = path.join(outsideTransactions, 'sentinel.json');

  await fs.ensureDir(outsideTransactions);
  await writeFile(outsideHistory, '[{"outside":true}]', 'utf8');
  await writeFile(outsideSentinel, '{"outside":true}', 'utf8');
  const outsideMetadataEntries = (await fs.readdir(outsideMetadata)).sort();
  const outsideTransactionEntries = (await fs.readdir(outsideTransactions)).sort();
  const outsideHistoryContent = await readFile(outsideHistory, 'utf8');

  await writeFile(path.join(projectRoot, 'value.txt'), 'before\n', 'utf8');
  await writeFile(
    path.join(projectRoot, 'swap-root-and-fail.cjs'),
    [
      "const fs = require('node:fs');",
      'const projectRoot = process.cwd();',
      'fs.renameSync(projectRoot, `${projectRoot}-displaced`);',
      `fs.symlinkSync(${JSON.stringify(outsideRoot)}, projectRoot, 'dir');`,
      'process.exit(1);',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node swap-root-and-fail.cjs' } }),
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

    assert.deepEqual((await fs.readdir(outsideMetadata)).sort(), outsideMetadataEntries);
    assert.deepEqual(
      (await fs.readdir(outsideTransactions)).sort(),
      outsideTransactionEntries,
    );
    assert.equal(await readFile(outsideHistory, 'utf8'), outsideHistoryContent);
    assert.equal(await readFile(outsideSentinel, 'utf8'), '{"outside":true}');

    const displacedMetadata = path.join(displacedRoot, '.openbrowser');
    const displacedTransactions = path.join(displacedMetadata, 'transactions');
    const displacedEntries = await fs.readdir(displacedTransactions);
    const journalName = displacedEntries.find((name) => name.endsWith('.json'));
    assert.ok(journalName, 'the displaced real project retains its transaction journal');
    assert.ok(
      displacedEntries.some((name) => name.endsWith('.backup')),
      'the displaced real project retains rollback backup evidence',
    );
    assert.equal(
      await fs.pathExists(path.join(displacedMetadata, 'history.json')),
      false,
      'history is not fabricated after project-root identity is lost',
    );

    const journal = await fs.readJson(path.join(displacedTransactions, journalName)) as {
      status?: string;
      activeOperation?: number;
      rollbackStatus?: string;
    };
    assert.equal(journal.status, 'applying');
    assert.equal(journal.activeOperation, 1);
    assert.equal(journal.rollbackStatus, undefined);
    assert.equal(await readFile(path.join(displacedRoot, 'value.txt'), 'utf8'), 'after\n');
  } finally {
    await fs.remove(projectRoot);
    await fs.remove(displacedRoot);
    await fs.remove(outsideRoot);
  }
});
