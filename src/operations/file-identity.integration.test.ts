import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { FileOperation } from '../core/types/index.ts';
import {
  executePlannedOperations,
  planOperations,
  type ExecuteOptions,
  type PlannedOperation,
} from './index.ts';

interface OperationSecurityHooks {
  afterPreconditionCapture?: () => Promise<void> | void;
  afterTransactionBackup?: (context: { backupRoot: string }) => Promise<void> | void;
}

interface ExecuteWithSecurityHooksOptions extends ExecuteOptions {
  securityHooks?: OperationSecurityHooks;
}

type ExecuteWithSecurityHooks = (
  plans: PlannedOperation[],
  projectRoot: string,
  options?: ExecuteWithSecurityHooksOptions,
) => ReturnType<typeof executePlannedOperations>;

const executeWithSecurityHooks = executePlannedOperations as ExecuteWithSecurityHooks;
const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

test('rejects a same-content replacement because it is not the approved file identity', async () => {
  const projectRoot = await temporaryDirectory('operation-identity-replacement-');
  const targetPath = path.join(projectRoot, 'value.txt');
  const displacedPath = path.join(projectRoot, 'value-approved.txt');
  await writeFile(targetPath, 'approved bytes\n', 'utf8');

  const plans = await planOperations([editOperation('value.txt')], projectRoot);
  await rename(targetPath, displacedPath);
  await writeFile(targetPath, 'approved bytes\n', 'utf8');

  await assert.rejects(
    executePlannedOperations(plans, projectRoot),
    /identity|precondition|changed/i,
  );
  assert.equal(await readFile(targetPath, 'utf8'), 'approved bytes\n');
  assert.equal(await readFile(displacedPath, 'utf8'), 'approved bytes\n');
});

test('writes the transaction backup from captured approved bytes instead of reopening the pathname', async () => {
  const projectRoot = await temporaryDirectory('operation-identity-backup-');
  const targetPath = path.join(projectRoot, 'value.txt');
  const displacedPath = path.join(projectRoot, 'value-approved.txt');
  await writeFile(targetPath, 'approved bytes\n', 'utf8');

  const plans = await planOperations([editOperation('value.txt')], projectRoot);
  let observedBackup: string | undefined;

  await assert.rejects(
    executeWithSecurityHooks(plans, projectRoot, {
      securityHooks: {
        afterPreconditionCapture: async () => {
          await rename(targetPath, displacedPath);
          await writeFile(targetPath, 'replacement secret\n', 'utf8');
        },
        afterTransactionBackup: async ({ backupRoot }) => {
          const backupNames = await readdir(backupRoot);
          assert.equal(backupNames.length, 1);
          observedBackup = await readFile(path.join(backupRoot, backupNames[0]!), 'utf8');
        },
      },
    }),
    /identity|precondition|changed/i,
  );

  assert.equal(observedBackup, 'approved bytes\n');
  assert.equal(await readFile(displacedPath, 'utf8'), 'approved bytes\n');
});

function editOperation(relativePath: string): FileOperation {
  return {
    action: 'EDIT_FILE',
    path: relativePath,
    search: 'approved bytes',
    replace: 'edited bytes',
  };
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
