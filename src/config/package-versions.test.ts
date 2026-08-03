import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../');

test('package.json versions are intentionally versioned', () => {
  const rootPackage = JSON.parse(
    readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  ) as { version?: string; name?: string };
  const extensionPackage = JSON.parse(
    readFileSync(path.join(repoRoot, 'browser-extension/package.json'), 'utf8'),
  ) as { version?: string; name?: string };

  assert.ok(rootPackage.version, 'Root package.json must have version field');
  assert.ok(
    extensionPackage.version,
    'Browser extension package.json must have version field',
  );

  // Document versioning strategy:
  // - Root package (Titan Builder CLI): 0.x.x - represents CLI/service version
  // - Browser extension: 1.x.x - represents independently versioned browser extension
  // This is intentional to allow independent release cycles while keeping both fields defined.
  const rootVersion = rootPackage.version;
  const extensionVersion = extensionPackage.version;

  // Both must start with semantic versioning pattern
  assert.match(
    rootVersion,
    /^\d+\.\d+\.\d+/,
    `Root version '${rootVersion}' must follow semantic versioning`,
  );
  assert.match(
    extensionVersion,
    /^\d+\.\d+\.\d+/,
    `Extension version '${extensionVersion}' must follow semantic versioning`,
  );

  console.log(`Package versions verified: root=${rootVersion}, extension=${extensionVersion}`);
});
