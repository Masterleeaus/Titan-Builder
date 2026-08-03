import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readOperationSources(): Promise<{
  publicSource: string;
  coreSource: string;
  combinedSource: string;
}> {
  const [publicSource, coreSource] = await Promise.all([
    readFile(new URL('./index.ts', import.meta.url), 'utf8'),
    readFile(new URL('./index-core.ts', import.meta.url), 'utf8'),
  ]);
  return {
    publicSource,
    coreSource,
    combinedSource: `${publicSource}\n${coreSource}`,
  };
}

test('operations route every file path and command cwd through canonical containment', async () => {
  const { publicSource, coreSource, combinedSource } = await readOperationSources();

  assert.match(publicSource, /from '\.\.\/security\/verified-file\.js'/);
  assert.match(publicSource, /from '\.\/index-core\.js'/);
  assert.match(coreSource, /from '\.\.\/security\/project-path\.js'/);
  assert.doesNotMatch(combinedSource, /function resolveInsideRoot/);
  assert.match(coreSource, /await canonicalizeProjectRoot\(projectRoot\)/);
  assert.match(coreSource, /resolveProjectPath\(root, operation\.path/);
  assert.match(coreSource, /expectedType: 'directory'/);
  assert.match(coreSource, /resolveProjectPath\(projectRoot, operation\.replace/);
  assert.match(coreSource, /resolveProjectPath\(projectRoot, operation\.path/);
});

test('file writes and approved reads retain no-follow and identity verification boundaries', async () => {
  const { publicSource, coreSource } = await readOperationSources();

  assert.match(coreSource, /O_NOFOLLOW/);
  assert.match(coreSource, /safeWriteFile/);
  assert.match(coreSource, /revalidateParentDirectory/);
  assert.match(publicSource, /openVerifiedRegularFile/);
  assert.match(publicSource, /sameFileIdentity/);
  assert.match(publicSource, /captureApprovedFiles/);
});
