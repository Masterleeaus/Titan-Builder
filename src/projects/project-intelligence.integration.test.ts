import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('CLI exposes project, memory, and context commands and injects memory into prompts', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8');
  assert.match(source, /program\.command\('project'\)/);
  assert.match(source, /program\.command\('memory'\)/);
  assert.match(source, /program\.command\('context'\)/);
  assert.match(source, /formatProjectMemory\(await listProjectMemory\(process\.cwd\(\)\)\)/);
  assert.match(source, /buildBudgetedContext\(process\.cwd\(\), contextPaths/);
  assert.match(source, /--budget <characters>/);
  assert.match(source, /--context <paths\.\.\.>/);
});

test('bridge preview returns context metadata without local file contents', async () => {
  const source = await readFile(new URL('../server/index.ts', import.meta.url), 'utf8');
  assert.match(source, /app\.post\('\/project\/context\/preview'/);
  assert.match(source, /included: result\.included\.map\(\(\{ content: _content, \.\.\.item \}\) => item\)/);
  assert.doesNotMatch(source, /app\.post\('\/project\/context\/preview'[\s\S]*return result;/);
});
