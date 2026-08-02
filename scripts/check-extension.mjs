import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

const htmlFiles = walkFiles(path.join(extensionRoot, 'src'), (name) => name.endsWith('.html'));
for (const absolutePath of htmlFiles) {
  const html = fs.readFileSync(absolutePath, 'utf8');
  const relativePath = path.relative(extensionRoot, absolutePath);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${relativePath} contains inline script incompatible with MV3 CSP`);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${relativePath} contains inline event handlers`);
}

const jsFiles = walkFiles(path.join(extensionRoot, 'src'), (name) => name.endsWith('.js'));
for (const absolutePath of jsFiles) {
  const source = fs.readFileSync(absolutePath, 'utf8');
  const relativePath = path.relative(extensionRoot, absolutePath);
  assert.doesNotMatch(source, /\beval\s*\(/, `${relativePath} uses eval()`);
  assert.doesNotMatch(source, /new\s+Function\s*\(/, `${relativePath} uses new Function()`);
}

const catalogPath = path.join(extensionRoot, 'src', 'generated', 'prompt-catalog.js');
assert.ok(fs.existsSync(catalogPath), 'generated prompt catalog is required');
const { GENERATED_PROMPT_CATALOG } = await import(`${pathToFileURL(catalogPath).href}?check=${Date.now()}`);
assert.ok(Array.isArray(GENERATED_PROMPT_CATALOG), 'generated prompt catalog must export an array');
assert.ok(GENERATED_PROMPT_CATALOG.length > 0, 'generated prompt catalog must contain canonical prompts');

const promptIds = new Set();
for (const record of GENERATED_PROMPT_CATALOG) {
  assert.ok(record?.id, 'generated prompt record requires an ID');
  assert.ok(!promptIds.has(record.id), `duplicate generated prompt ID: ${record.id}`);
  promptIds.add(record.id);
  assert.ok(typeof record.path === 'string' && record.path.startsWith('prompt-library/'), `invalid prompt source path: ${record.id}`);
  assert.ok(!record.path.includes('..') && !path.posix.isAbsolute(record.path), `unsafe prompt source path: ${record.id}`);
  const bodyPath = path.resolve(extensionRoot, record.path);
  assert.ok(bodyPath.startsWith(`${extensionRoot}${path.sep}`), `prompt path escapes extension root: ${record.id}`);
  assert.ok(fs.existsSync(bodyPath), `generated prompt record references missing body: ${record.path}`);
  const body = fs.readFileSync(bodyPath, 'utf8');
  assert.match(body, new RegExp(`^\\|\\s*ID\\s*\\|\\s*\`?${escapeRegExp(record.id)}\`?\\s*\\|\\s*$`, 'imu'), `prompt body ID mismatch: ${record.id}`);
}

console.log(JSON.stringify({
  ok: true,
  manifestVersion: manifest.manifest_version,
  extensionVersion: manifest.version,
  referencedFiles: referencedFiles.size,
  htmlFilesChecked: htmlFiles.length,
  javascriptFilesChecked: jsFiles.length,
  canonicalPromptsChecked: GENERATED_PROMPT_CATALOG.length,
}, null, 2));

function walkFiles(directory, predicate) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolutePath, predicate));
    else if (entry.isFile() && predicate(entry.name)) files.push(absolutePath);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
