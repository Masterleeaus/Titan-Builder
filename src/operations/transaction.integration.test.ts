import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import fs from 'fs-extra';

import { executeOperations, executePlannedOperations, planOperations } from './index.js';

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


test('execution rejects an approved plan when a file changes after preview', async () => {
  const projectRoot = await createProject();
  const filePath = path.join(projectRoot, 'guarded.txt');
  await writeFile(filePath, 'approved\n', 'utf8');

  try {
    const plans = await planOperations([
      { action: 'EDIT_FILE', path: 'guarded.txt', content: 'agent-change\n' },
    ], projectRoot);
    await writeFile(filePath, 'external-change\n', 'utf8');

    await assert.rejects(
      executePlannedOperations(plans, projectRoot),
      /precondition changed/i,
    );
    assert.equal(await readFile(filePath, 'utf8'), 'external-change\n');
  } finally {
    await fs.remove(projectRoot);
  }
});

test('a failed multi-file transaction restores earlier mutations and records rollback status', async () => {
  const projectRoot = await createProject();
  const firstPath = path.join(projectRoot, 'first.txt');
  const createdPath = path.join(projectRoot, 'created.txt');
  await writeFile(firstPath, 'original\n', 'utf8');
  await writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e \"process.exit(1)\"' } }),
    'utf8',
  );

  try {
    await assert.rejects(
      executeOperations([
        { action: 'EDIT_FILE', path: 'first.txt', content: 'changed\n' },
        { action: 'CREATE_FILE', path: 'created.txt', content: 'temporary\n' },
        { action: 'RUN_TOOL', tool: 'npm.run', args: ['test'] },
      ], projectRoot, { conversationId: 'rollback-test' }),
      /rollback/i,
    );

    assert.equal(await readFile(firstPath, 'utf8'), 'original\n');
    assert.equal(await fs.pathExists(createdPath), false);

    const history = await fs.readJson(path.join(projectRoot, '.openbrowser', 'history.json')) as Array<{
      conversationId?: string;
      status?: string;
      rollbackStatus?: string;
    }>;
    const entry = history.at(-1);
    assert.equal(entry?.conversationId, 'rollback-test');
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


test('package scripts lock their manifest at preview and reject later script replacement', async () => {
  const projectRoot = await createProject();
  const packagePath = path.join(projectRoot, 'package.json');
  await writeFile(
    packagePath,
    JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
    'utf8',
  );

  try {
    const plans = await planOperations([
      { action: 'RUN_TOOL', tool: 'npm.test' },
    ], projectRoot);
    assert.equal(plans[0]?.risk, 'ARBITRARY_EXECUTION');
    assert.ok(plans[0]?.preconditions.some((entry) => entry.absolutePath === packagePath));

    await writeFile(
      packagePath,
      JSON.stringify({ scripts: { test: 'node -e "process.exit(99)"' } }),
      'utf8',
    );

    await assert.rejects(
      executePlannedOperations(plans, projectRoot),
      /precondition changed/i,
    );
  } finally {
    await fs.remove(projectRoot);
  }
});

test('dependency installation requires a lockfile and previews lifecycle-disabled network execution', async () => {
  const projectRoot = await createProject();
  await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ dependencies: {} }), 'utf8');

  try {
    await assert.rejects(
      planOperations([{ action: 'RUN_TOOL', tool: 'npm.install' }], projectRoot),
      /requires package-lock\.json/i,
    );

    const lockPath = path.join(projectRoot, 'package-lock.json');
    await writeFile(lockPath, JSON.stringify({ lockfileVersion: 3, packages: {} }), 'utf8');
    const plans = await planOperations([{ action: 'RUN_TOOL', tool: 'npm.install' }], projectRoot);

    assert.equal(plans[0]?.risk, 'NETWORK_WRITE');
    assert.match(plans[0]?.diff ?? '', /npm ci --ignore-scripts/);
    assert.ok(plans[0]?.preconditions.some((entry) => entry.absolutePath === lockPath));
  } finally {
    await fs.remove(projectRoot);
  }
});
