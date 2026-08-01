import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const extensionRoot = path.join(root, 'browser-extension');
const manifestPath = path.join(extensionRoot, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const forbiddenPermissions = new Set([
  '<all_urls>',
  'debugger',
  'webRequest',
  'webRequestBlocking',
  'declarativeNetRequestWithHostAccess',
  'nativeMessaging',
]);

const permissions = [
  ...(manifest.permissions || []),
  ...(manifest.optional_permissions || []),
  ...(manifest.host_permissions || []),
  ...(manifest.optional_host_permissions || []),
];

for (const permission of permissions) {
  assert.ok(!forbiddenPermissions.has(permission), `forbidden extension permission: ${permission}`);
  assert.notEqual(permission, '*://*/*', 'wildcard host permission is forbidden');
}

assert.equal(manifest.manifest_version, 3, 'extension must remain Manifest V3');
assert.ok(manifest.background?.service_worker, 'background service worker is required');
assert.ok(manifest.side_panel?.default_path, 'side panel entry point is required');

const referencedFiles = new Set();
referencedFiles.add(manifest.background.service_worker);
referencedFiles.add(manifest.side_panel.default_path);
if (manifest.action?.default_popup) referencedFiles.add(manifest.action.default_popup);
for (const contentScript of manifest.content_scripts || []) {
  for (const file of contentScript.js || []) referencedFiles.add(file);
  for (const file of contentScript.css || []) referencedFiles.add(file);
}
for (const icon of Object.values(manifest.icons || {})) referencedFiles.add(icon);
for (const icon of Object.values(manifest.action?.default_icon || {})) referencedFiles.add(icon);

for (const relativePath of referencedFiles) {
  const absolutePath = path.join(extensionRoot, relativePath);
  assert.ok(fs.existsSync(absolutePath), `manifest references missing file: ${relativePath}`);
}

const htmlFiles = fs.readdirSync(path.join(extensionRoot, 'src'))
  .filter((name) => name.endsWith('.html'));
for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(extensionRoot, 'src', file), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${file} contains inline script incompatible with MV3 CSP`);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${file} contains inline event handlers`);
}

const jsFiles = fs.readdirSync(path.join(extensionRoot, 'src'))
  .filter((name) => name.endsWith('.js'));
for (const file of jsFiles) {
  const source = fs.readFileSync(path.join(extensionRoot, 'src', file), 'utf8');
  assert.doesNotMatch(source, /\beval\s*\(/, `${file} uses eval()`);
  assert.doesNotMatch(source, /new\s+Function\s*\(/, `${file} uses new Function()`);
}

console.log(JSON.stringify({
  ok: true,
  manifestVersion: manifest.manifest_version,
  extensionVersion: manifest.version,
  referencedFiles: referencedFiles.size,
  htmlFilesChecked: htmlFiles.length,
  javascriptFilesChecked: jsFiles.length,
}, null, 2));
