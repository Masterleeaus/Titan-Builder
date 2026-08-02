import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  packageManifestSnapshotChanged,
  runProjectVerification,
} from './index.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

test('malformed package.json fails verification instead of reporting a skip', async () => {
  const root = await temporaryDirectory('verification-invalid-json-');
  await writeFile(path.join(root, 'package.json'), '{"scripts":', 'utf8');

  const result = await runProjectVerification(root, 'standard');

  assert.equal(result.status, 'failed');
  assert.equal(result.operationCount, 0);
  assert.equal(result.errorCode, 'PACKAGE_MANIFEST_INVALID_JSON');
  assert.match(result.error ?? '', /package\.json.*valid JSON/i);
});

test('invalid manifest and scripts shapes fail verification', async () => {
  const invalidManifestRoot = await temporaryDirectory('verification-invalid-manifest-shape-');
  await writeFile(path.join(invalidManifestRoot, 'package.json'), '[]', 'utf8');

  const invalidManifest = await runProjectVerification(invalidManifestRoot, 'standard');
  assert.equal(invalidManifest.status, 'failed');
  assert.equal(invalidManifest.errorCode, 'PACKAGE_MANIFEST_INVALID_SHAPE');

  const invalidScriptsRoot = await temporaryDirectory('verification-invalid-scripts-shape-');
  await writeFile(
    path.join(invalidScriptsRoot, 'package.json'),
    JSON.stringify({ scripts: ['test'] }),
    'utf8',
  );

  const invalidScripts = await runProjectVerification(invalidScriptsRoot, 'standard');
  assert.equal(invalidScripts.status, 'failed');
  assert.equal(invalidScripts.errorCode, 'PACKAGE_SCRIPTS_INVALID');

  const invalidCommandRoot = await temporaryDirectory('verification-invalid-script-command-');
  await writeFile(
    path.join(invalidCommandRoot, 'package.json'),
    JSON.stringify({ scripts: { test: true } }),
    'utf8',
  );

  const invalidCommand = await runProjectVerification(invalidCommandRoot, 'standard');
  assert.equal(invalidCommand.status, 'failed');
  assert.equal(invalidCommand.errorCode, 'PACKAGE_SCRIPTS_INVALID');
});

test('a genuinely missing package manifest remains an explicit skip', async () => {
  const root = await temporaryDirectory('verification-no-package-');

  const result = await runProjectVerification(root, 'standard');

  assert.equal(result.status, 'skipped');
  assert.equal(result.operationCount, 0);
  assert.match(result.summary, /no package\.json was found/i);
});

test('a valid manifest with no approved scripts remains an explicit skip', async () => {
  const root = await temporaryDirectory('verification-empty-scripts-');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: {} }), 'utf8');

  const result = await runProjectVerification(root, 'standard');

  assert.equal(result.status, 'skipped');
  assert.equal(result.operationCount, 0);
  assert.match(result.summary, /no approved standard verification scripts/i);
});

test('a symlinked package manifest fails closed', async (context) => {
  const root = await temporaryDirectory('verification-symlink-package-');
  const outside = await temporaryDirectory('verification-symlink-target-');
  const target = path.join(outside, 'package.json');
  await writeFile(target, JSON.stringify({ scripts: {} }), 'utf8');

  try {
    await symlink(target, path.join(root, 'package.json'), 'file');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      context.skip('The current platform does not permit test symlink creation');
      return;
    }
    throw error;
  }

  const result = await runProjectVerification(root, 'standard');
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'PACKAGE_MANIFEST_SYMLINK');
});

test('a non-file package manifest fails closed', async () => {
  const root = await temporaryDirectory('verification-directory-package-');
  await mkdir(path.join(root, 'package.json'));

  const result = await runProjectVerification(root, 'standard');

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'PACKAGE_MANIFEST_NOT_FILE');
});

test('unreadable package metadata preserves a typed filesystem failure', async (context) => {
  const root = await temporaryDirectory('verification-unreadable-package-');
  const manifest = path.join(root, 'package.json');
  await writeFile(manifest, JSON.stringify({ scripts: {} }), 'utf8');
  await chmod(manifest, 0o000);

  try {
    const result = await runProjectVerification(root, 'standard');
    if (result.status !== 'failed') {
      context.skip('The current user can read mode-000 files');
      return;
    }
    assert.equal(result.errorCode, 'PACKAGE_MANIFEST_UNREADABLE');
    assert.match(result.error ?? '', /EACCES|EPERM|permission/i);
  } finally {
    await chmod(manifest, 0o600).catch(() => undefined);
  }
});

test('manifest snapshots detect replacement and concurrent modification signals', () => {
  const initial = { dev: 1, ino: 2, size: 10, mtimeMs: 100, ctimeMs: 100 };

  assert.equal(packageManifestSnapshotChanged(initial, { ...initial }), false);
  assert.equal(packageManifestSnapshotChanged(initial, { ...initial, ino: 3 }), true);
  assert.equal(packageManifestSnapshotChanged(initial, { ...initial, size: 11 }), true);
  assert.equal(packageManifestSnapshotChanged(initial, { ...initial, mtimeMs: 101 }), true);
  assert.equal(packageManifestSnapshotChanged(initial, { ...initial, ctimeMs: 101 }), true);
});
