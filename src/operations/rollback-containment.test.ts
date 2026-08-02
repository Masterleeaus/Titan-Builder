import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import fs from 'fs-extra';
import { preflightRollback, type RollbackPathRecord } from './rollback-containment.ts';

async function createFixture(t: TestContext): Promise<{
  projectRoot: string;
  backupRoot: string;
  targetPath: string;
  backupPath: string;
}> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openbrowser-rollback-integrity-'));
  t.after(async () => {
    await fs.remove(projectRoot);
  });

  const targetPath = path.join(projectRoot, 'src', 'value.txt');
  const backupRoot = path.join(projectRoot, '.openbrowser', 'transactions', 'fixture.backup');
  const backupPath = path.join(backupRoot, '0.bak');
  await fs.ensureDir(path.dirname(targetPath));
  await fs.ensureDir(backupRoot);
  await fs.writeFile(targetPath, 'current value\n', 'utf8');
  return { projectRoot, backupRoot, targetPath, backupPath };
}

function fileHash(content: string): string {
  return crypto
    .createHash('sha256')
    .update('file')
    .update('\0')
    .update(content)
    .digest('hex');
}

function fileSnapshot(
  projectRoot: string,
  targetPath: string,
  backupPath: string,
  originalContent: string,
): RollbackPathRecord {
  return {
    absolutePath: targetPath,
    relativePath: path.relative(projectRoot, targetPath),
    backupPath,
    kind: 'file',
    hash: fileHash(originalContent),
    role: 'target',
  };
}

test('preflight accepts a contained regular backup with the recorded content hash', async (t) => {
  const fixture = await createFixture(t);
  const originalContent = 'original value\n';
  await fs.writeFile(fixture.backupPath, originalContent, 'utf8');

  const validation = await preflightRollback(
    fixture.projectRoot,
    fixture.backupRoot,
    [fileSnapshot(fixture.projectRoot, fixture.targetPath, fixture.backupPath, originalContent)],
  );

  assert.equal(validation.targets.length, 1);
  assert.equal(validation.backupRoot, fixture.backupRoot);
});

test('preflight rejects a modified rollback backup before project mutation', async (t) => {
  const fixture = await createFixture(t);
  const originalContent = 'original value\n';
  await fs.writeFile(fixture.backupPath, 'modified value\n', 'utf8');

  await assert.rejects(
    preflightRollback(
      fixture.projectRoot,
      fixture.backupRoot,
      [fileSnapshot(fixture.projectRoot, fixture.targetPath, fixture.backupPath, originalContent)],
    ),
    /integrity validation/i,
  );

  assert.equal(await fs.readFile(fixture.targetPath, 'utf8'), 'current value\n');
  assert.equal(await fs.readFile(fixture.backupPath, 'utf8'), 'modified value\n');
});
