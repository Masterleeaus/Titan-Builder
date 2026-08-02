import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadTools() {
  const source = await readFile(new URL('./chatgpt-page-tools.js', import.meta.url), 'utf8');
  const context = { globalThis: {}, URL };
  vm.runInNewContext(source, context, { filename: 'chatgpt-page-tools.js' });
  return context.globalThis.OpenBrowserChatGPTTools;
}

test('classifies ChatGPT app/plugin candidates and excludes generic controls', async () => {
  const tools = await loadTools();
  assert.equal(tools.classifyAppCandidate({ text: 'Canva', href: 'https://chatgpt.com/g/g-canva' })?.name, 'Canva');
  assert.equal(tools.classifyAppCandidate({ text: 'Settings', href: 'https://chatgpt.com/#settings' }), null);
  assert.equal(tools.classifyAppCandidate({ text: 'Search plugins', href: '' }), null);
});

test('classifies visible file candidates by filename or download URL', async () => {
  const tools = await loadTools();
  assert.equal(tools.classifyFileCandidate({ text: 'architecture.md', href: 'https://chatgpt.com/backend-api/files/a/content' })?.name, 'architecture.md');
  assert.equal(tools.classifyFileCandidate({ text: 'Download report', href: 'https://files.oaiusercontent.com/report.pdf' })?.name, 'report.pdf');
  assert.equal(tools.classifyFileCandidate({ text: 'Library', href: 'https://chatgpt.com/library' }), null);
});

test('deduplicates scan results using stable name and URL keys', async () => {
  const tools = await loadTools();
  const results = tools.dedupeItems([
    { type: 'file', name: 'a.md', url: 'https://example/a' },
    { type: 'file', name: 'a.md', url: 'https://example/a' },
    { type: 'file', name: 'b.md', url: 'https://example/b' },
  ]);
  assert.equal(results.length, 2);
});
