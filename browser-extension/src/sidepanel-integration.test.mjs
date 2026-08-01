import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { BUILTIN_CODING_PROMPTS } from './coding-prompts.js';

test('manifest exposes the coding side panel without broad or debugger permissions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.side_panel.default_path, 'src/sidepanel.html');
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(!manifest.permissions.includes('debugger'));
  assert.ok(!manifest.host_permissions.includes('<all_urls>'));
  for (const path of [
    manifest.side_panel.default_path,
    'src/sidepanel.js',
    'src/sidepanel.css',
    'src/coding-prompts.js',
  ]) {
    const fileUrl = new URL(`../${path}`, import.meta.url);
    const contents = await readFile(fileUrl, 'utf8');
    assert.ok(contents.length > 0, `${path} should exist and be non-empty`);
  }
});

test('coding prompt library has unique ids and useful coding categories', () => {
  assert.ok(BUILTIN_CODING_PROMPTS.length >= 10);
  assert.equal(new Set(BUILTIN_CODING_PROMPTS.map((prompt) => prompt.id)).size, BUILTIN_CODING_PROMPTS.length);
  const categories = new Set(BUILTIN_CODING_PROMPTS.map((prompt) => prompt.category));
  for (const category of ['Audit', 'Debugging', 'Implementation', 'Testing', 'Security']) {
    assert.ok(categories.has(category), `missing ${category}`);
  }
});


test('background and content scripts expose the prompt-routing message pair', async () => {
  const [background, content] = await Promise.all([
    readFile(new URL('./background.js', import.meta.url), 'utf8'),
    readFile(new URL('./content-script.js', import.meta.url), 'utf8'),
  ]);
  assert.match(background, /OPENBROWSER_USE_PROMPT/);
  assert.match(background, /OPENBROWSER_PROMPT/);
  assert.match(content, /OPENBROWSER_PROMPT/);
  assert.match(content, /handleLibraryPrompt/);
});

test('side panel exposes workspace, ChatGPT inventory, exporter, and settings views', async () => {
  const html = await readFile(new URL('./sidepanel.html', import.meta.url), 'utf8');
  for (const view of ['skills', 'agents', 'plugins', 'library', 'export', 'settings']) {
    assert.match(html, new RegExp(`data-view=["']${view}["']`));
    assert.match(html, new RegExp(`id=["']view-${view}["']`));
  }
  for (const control of [
    'scan-chatgpt-plugins',
    'scan-chatgpt-library',
    'scan-conversation-replies',
    'export-markdown',
    'export-zip',
    'auto-continue-enabled',
    'auto-continue-max',
  ]) {
    assert.match(html, new RegExp(`id=["']${control}["']`));
  }
});

test('manifest loads ChatGPT page tools before the content script', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.indexOf('src/chatgpt-page-tools.js') >= 0);
  assert.ok(scripts.indexOf('src/chatgpt-page-tools.js') < scripts.indexOf('src/content-script.js'));
});

test('project intelligence panels are wired to authenticated bridge endpoints', async () => {
  const [html, panel, server] = await Promise.all([
    readFile(new URL('./sidepanel.html', import.meta.url), 'utf8'),
    readFile(new URL('./sidepanel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/server/index.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /data-view="projects"/);
  assert.match(html, /data-view="memory"/);
  assert.match(html, /project-context-preview/);
  assert.match(panel, /\/projects/);
  assert.match(panel, /\/project\/memory/);
  assert.match(panel, /\/project\/context\/preview/);
  assert.match(server, /app\.get\('\/projects'/);
  assert.match(server, /app\.post\('\/project\/context\/preview'/);
});
