import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  openVerifiedRegularFile,
  sameFileIdentity,
} from './verified-file.ts';

const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

test('reads bytes and metadata from one retained regular-file handle', async () => {
  const directory = await temporaryDirectory('verified-file-stable-');
  const filePath = path.join(directory, 'value.txt');
  await writeFile(filePath, 'approved bytes\n', { encoding: 'utf8', mode: 0o640 });

  const verified = await openVerifiedRegularFile(filePath);
  try {
    assert.equal((await verified.readBuffer()).toString('utf8'), 'approved bytes\n');
    assert.equal(verified.path, filePath);
    assert.equal(typeof verified.mode, 'number');
    assert.equal(sameFileIdentity(verified.identity, verified.identity), true);
    assert.notEqual(verified.identity.device, '');
    assert.notEqual(verified.identity.inode, '');
  } finally {
    await verified.close();
  }
});

test('rejects a target replaced after pathname inspection and never returns replacement bytes', async () => {
  const directory = await temporaryDirectory('verified-file-swap-');
  const targetPath = path.join(directory, 'target.txt');
  const displacedPath = path.join(directory, 'target-original.txt');
  const replacementPath = path.join(directory, 'replacement.txt');
  await writeFile(targetPath, 'approved bytes\n', 'utf8');
  await writeFile(replacementPath, 'replacement secret\n', 'utf8');

  let hookRan = false;
  await assert.rejects(
    openVerifiedRegularFile(targetPath, {
      afterInitialInspection: async () => {
        hookRan = true;
        await rename(targetPath, displacedPath);
        if (process.platform === 'win32') {
          await writeFile(targetPath, await readFile(replacementPath));
        } else {
          await symlink(replacementPath, targetPath, 'file');
        }
      },
    }),
    /changed|symbolic link|identity|no-follow/i,
  );

  assert.equal(hookRan, true);
  assert.equal(await readFile(displacedPath, 'utf8'), 'approved bytes\n');
  assert.equal(await readFile(replacementPath, 'utf8'), 'replacement secret\n');
});

test('rejects content mutation while a retained handle is being read', async () => {
  const directory = await temporaryDirectory('verified-file-read-race-');
  const filePath = path.join(directory, 'value.txt');
  await writeFile(filePath, 'before\n', 'utf8');

  const verified = await openVerifiedRegularFile(filePath, {
    beforeRead: async () => {
      await writeFile(filePath, 'after mutation\n', 'utf8');
    },
  });
  try {
    await assert.rejects(
      verified.readBuffer(),
      /changed while it was being read|identity/i,
    );
  } finally {
    await verified.close();
  }
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
