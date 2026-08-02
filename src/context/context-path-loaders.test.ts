import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  listContextChoices,
  loadContextAttachments,
  loadContextFiles,
} from './file-context.ts';
import {
  collectProjectDirectories,
  scanDirectoryTree,
} from './directory-tree.ts';
import {
  normalizeContextReference,
  resolveContextPath,
} from './context-path.ts';

const invalidReferences = [
  '/tmp/file',
  'C:/tmp/file',
  'C:\\tmp\\file',
  'C:relative',
  '\\\\server\\share\\file',
  '//server/share/file',
  'file\0name',
];

test('rejects absolute, drive-qualified, UNC, and null-byte context references', () => {
  for (const value of invalidReferences) {
    assert.throws(
      () => normalizeContextReference(value),
      /context reference|relative path/i,
      value,
    );
  }
});

test('resolves an existing regular project file canonically', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-context-path-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'index.ts'), 'export const safe = true;\n');
    const canonicalRoot = await realpath(root);
    assert.deepEqual(await resolveContextPath(root, 'src/index.ts', {
      requireExisting: true,
      expectedType: 'file',
    }), {
      projectRoot: canonicalRoot,
      absolutePath: path.join(canonicalRoot, 'src', 'index.ts'),
      relativePath: 'src/index.ts',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy context loaders reject sibling-prefix and linked directory escapes', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-context-loaders-'));
  const root = path.join(base, 'project');
  const sibling = path.join(base, 'project-evil');
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(sibling, { recursive: true });
    await writeFile(path.join(root, 'src', 'inside.ts'), 'export const inside = true;\n');
    await writeFile(path.join(sibling, 'secret.txt'), 'outside project');
    await symlink(
      sibling,
      path.join(root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const files = await loadContextFiles(root, [
      'src/inside.ts',
      path.join(sibling, 'secret.txt'),
      'linked/secret.txt',
      'C:\\outside\\secret.txt',
    ]);
    assert.deepEqual(files.map((file) => file.path), ['src/inside.ts']);
    assert.equal(files[0]?.content.includes('outside project'), false);

    const attachments = await loadContextAttachments(root, ['src', 'linked']);
    assert.deepEqual(attachments.directories.map((directory) => directory.relativePath), ['src']);
    assert.equal(attachments.files.some((file) => file.content.includes('outside project')), false);

    assert.equal(await scanDirectoryTree(root, 'linked'), null);
    assert.equal((await collectProjectDirectories(root)).includes('linked/'), false);
    assert.equal((await listContextChoices(root)).some((choice) => choice.startsWith('linked/')), false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('legacy context source cannot reintroduce raw project-root prefix containment', async () => {
  const sourceRoot = path.dirname(new URL(import.meta.url).pathname);
  const sources = await Promise.all([
    readFile(path.join(sourceRoot, 'file-context.ts'), 'utf8'),
    readFile(path.join(sourceRoot, 'directory-tree.ts'), 'utf8'),
  ]);
  const combined = sources.join('\n');
  assert.match(combined, /resolveContextPath/u);
  assert.doesNotMatch(
    combined,
    /\.startsWith\(\s*(?:path\.resolve\(\s*)?(?:projectRoot|rootResolved)/u,
  );
});
