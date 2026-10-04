import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('fixture exposes a deterministic verification target', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('./package.json', import.meta.url), 'utf8'),
  );

  assert.equal(packageJson.name, 'titan-browser-first-fixture');
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.scripts.verify, 'node --test fixture.test.mjs');
});
