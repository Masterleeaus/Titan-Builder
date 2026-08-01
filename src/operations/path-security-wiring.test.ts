import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('operations route every file path and command cwd through canonical containment', async () => {
  const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

  assert.match(source, /from '\.\.\/security\/project-path\.js'/);
  assert.doesNotMatch(source, /function resolveInsideRoot/);
  assert.match(source, /await canonicalizeProjectRoot\(projectRoot\)/);
  assert.match(source, /resolveProjectPath\(root, operation\.path/);
  assert.match(source, /expectedType: 'directory'/);
  assert.match(source, /resolveProjectPath\(projectRoot, operation\.replace/);
  assert.match(source, /resolveProjectPath\(projectRoot, operation\.path/);
});

test('file writes use a no-follow file descriptor after parent revalidation', async () => {
  const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(source, /O_NOFOLLOW/);
  assert.match(source, /safeWriteFile/);
  assert.match(source, /revalidateParentDirectory/);
});
