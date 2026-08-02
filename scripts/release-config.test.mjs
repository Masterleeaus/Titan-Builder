import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const workspace = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');

function majorFromRange(range) {
  const match = String(range || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

test('pnpm workspace has no self-link override and allows esbuild build scripts', () => {
  assert.doesNotMatch(workspace, /openbrowser:\s*['"]?link:/i);
  assert.match(workspace, /allowBuilds:\s*[\s\S]*?esbuild:\s*true/i);
});

test('package metadata matches pnpm 11 runtime requirements and exposes verification scripts', () => {
  assert.ok(majorFromRange(packageJson.engines?.node) >= 22);
  assert.match(packageJson.packageManager || '', /^pnpm@11\./);
  for (const script of ['check:extension', 'smoke:cli', 'verify', 'verify:offline']) {
    assert.equal(typeof packageJson.scripts?.[script], 'string', `missing script ${script}`);
  }
});

test('release includes Windows setup and GitHub verification workflow', () => {
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'install-windows.ps1')));
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'check-extension.mjs')));
  assert.ok(fs.existsSync(path.join(root, '.github', 'workflows', 'verify.yml')));
});

test('CLI version is read from package metadata instead of hardcoded', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'index.ts'), 'utf8');
  assert.match(source, /packageMetadata\.version/);
  assert.doesNotMatch(source, /\.version\(['"]\d+\.\d+\.\d+['"]\)/);
});

test('popup renders the extension version from the manifest instead of hardcoding it', () => {
  const html = fs.readFileSync(path.join(root, 'browser-extension', 'src', 'popup.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'browser-extension', 'src', 'popup.js'), 'utf8');
  assert.doesNotMatch(html, /v\d+\.\d+\.\d+/);
  assert.match(html, /id=["']extension-version["']/);
  assert.match(source, /chrome\.runtime\.getManifest\(\)\.version/);
});

test('package and extension versions match for a coherent release', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'browser-extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, packageJson.version);
});


test('release documents distinct secure bridge credentials and the explicit development escape hatch', () => {
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const installer = fs.readFileSync(path.join(root, 'scripts', 'install-windows.ps1'), 'utf8');
  const popup = fs.readFileSync(path.join(root, 'browser-extension', 'src', 'popup.html'), 'utf8');

  assert.match(example, /^BRIDGE_TOKEN=/m);
  assert.match(example, /^BRIDGE_BROWSER_TOKEN=/m);
  assert.match(example, /^OPENBROWSER_INSECURE_DEV=0$/m);
  assert.match(readme, /BRIDGE_BROWSER_TOKEN/);
  assert.match(readme, /OPENBROWSER_INSECURE_DEV=1/);
  assert.match(installer, /BRIDGE_BROWSER_TOKEN=/);
  assert.match(popup, /BRIDGE_BROWSER_TOKEN/);
});

test('test scripts use the Node test runner once and include bridge integration', () => {
  const testScript = packageJson.scripts?.test || '';
  const verifyScript = packageJson.scripts?.verify || '';

  assert.equal(typeof packageJson.scripts?.['test:integration'], 'string');
  assert.match(testScript, /test:node/);
  assert.match(testScript, /test:integration/);
  assert.doesNotMatch(testScript, /vitest/);
  assert.match(verifyScript, /pnpm run test(?:\s|$)/);
  assert.doesNotMatch(verifyScript, /test:node|test:integration|vitest/);

  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /openbrowser verify --profile standard/);
});
