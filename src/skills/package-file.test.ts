import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { resolveContainedPackageFile } from './package-file.ts';

async function fixture(t: TestContext): Promise<{ packageRoot: string; outside: string }> {
  const base = await mkdtemp(path.join(os.tmpdir(), 'titan-skill-entrypoint-'));
  t.after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const packageRoot = path.join(base, 'package');
  const outside = path.join(base, 'outside');
  await mkdir(path.join(packageRoot, 'runtime'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(packageRoot, 'runtime', 'entrypoint.js'), 'export const handler = true;');
  await writeFile(path.join(outside, 'outside.js'), 'export const handler = false;');
  return { packageRoot, outside };
}

test('accepts an existing regular file with no linked path components', async (t) => {
  const { packageRoot } = await fixture(t);
  assert.equal(
    await resolveContainedPackageFile(packageRoot, 'runtime/entrypoint.js'),
    await realpath(path.join(packageRoot, 'runtime', 'entrypoint.js')),
  );
});

test('rejects a package-local symlink even when it resolves inside the package', async (t) => {
  const { packageRoot } = await fixture(t);
  await symlink(
    path.join(packageRoot, 'runtime', 'entrypoint.js'),
    path.join(packageRoot, 'runtime', 'alias.js'),
    'file',
  );
  await assert.rejects(
    () => resolveContainedPackageFile(packageRoot, 'runtime/alias.js'),
    /symbolic link|junction/i,
  );
});

test('rejects symlink escape, missing files, and directories', async (t) => {
  const { packageRoot, outside } = await fixture(t);
  await symlink(outside, path.join(packageRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    () => resolveContainedPackageFile(packageRoot, 'linked/outside.js'),
    /symbolic link|junction|escape/i,
  );
  await assert.rejects(
    () => resolveContainedPackageFile(packageRoot, 'runtime/missing.js'),
    /unable|exist|read/i,
  );
  await assert.rejects(
    () => resolveContainedPackageFile(packageRoot, 'runtime'),
    /regular file/i,
  );
});
