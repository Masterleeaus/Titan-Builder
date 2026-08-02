import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildBudgetedContext,
  formatContextBudgetPreview,
  isSensitiveContextPath,
} from './context-budget.ts';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openbrowser-context-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'tests'), { recursive: true });
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  writeFileSync(path.join(root, 'src', 'index.ts'), 'export const important = true;\n'.repeat(20));
  writeFileSync(path.join(root, 'tests', 'index.test.ts'), 'test("important", () => {});\n'.repeat(20));
  writeFileSync(path.join(root, 'docs', 'architecture.md'), '# Architecture\n'.repeat(20));
  writeFileSync(path.join(root, '.env'), 'SECRET=never-send\n');
  writeFileSync(path.join(root, 'private.key'), 'never-send\n');
  return root;
}

test('detects sensitive repository paths', () => {
  assert.equal(isSensitiveContextPath('.env'), true);
  assert.equal(isSensitiveContextPath('config/.env.production'), true);
  assert.equal(isSensitiveContextPath('keys/private.key'), true);
  assert.equal(isSensitiveContextPath('src/index.ts'), false);
});

test('selects deterministic context within a total budget and excludes secrets', async () => {
  const root = fixture();
  const result = await buildBudgetedContext(root, ['.'], {
    totalCharacters: 900,
    perFileCharacters: 500,
    maxFiles: 10,
  });

  assert.equal(result.totalCharacters <= 900, true);
  assert.equal(result.included.some((item) => item.path === 'package.json'), true);
  assert.equal(result.included.some((item) => item.path === '.env'), false);
  assert.equal(result.included.some((item) => item.path === 'private.key'), false);
  assert.equal(result.excluded.some((item) => item.path === '.env' && item.reason === 'sensitive'), true);
  assert.deepEqual(
    result.included.map((item) => item.path),
    [...result.included].sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path)).map((item) => item.path),
  );
});

test('reports truncation and formats a readable preview', async () => {
  const root = fixture();
  const result = await buildBudgetedContext(root, ['src/index.ts'], {
    totalCharacters: 120,
    perFileCharacters: 100,
    maxFiles: 2,
  });
  const preview = formatContextBudgetPreview(result);

  assert.equal(result.included[0]?.truncated, true);
  assert.match(preview, /Context budget preview/);
  assert.match(preview, /src\/index\.ts/);
  assert.match(preview, /truncated/);
});

test('rejects explicit symlinks that resolve outside the project root', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openbrowser-context-root-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'openbrowser-context-outside-'));
  writeFileSync(path.join(outside, 'secret.txt'), 'outside project');
  symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'linked-secret.txt'));

  const result = await buildBudgetedContext(root, ['linked-secret.txt'], { totalCharacters: 1000 });

  assert.equal(result.included.length, 0);
  assert.equal(result.excluded.some((item) => item.path === 'linked-secret.txt' && item.reason === 'outside-root'), true);
});

