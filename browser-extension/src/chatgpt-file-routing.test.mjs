import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function functionSource(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('content script delegates file bytes to the bounded background path', async () => {
  const source = await readFile(new URL('./content-script.js', import.meta.url), 'utf8');
  const handler = functionSource(source, 'handleChatGPTFileFetch');

  assert.match(handler, /OPENBROWSER_FETCH_CHATGPT_FILE/);
  assert.doesNotMatch(handler, /\bfetch\s*\(/);
  assert.doesNotMatch(handler, /arrayBuffer\s*\(/);
  assert.doesNotMatch(handler, /credentials\s*:/);
});

test('background file handler uses the shared bounded downloader', async () => {
  const source = await readFile(new URL('./background.js', import.meta.url), 'utf8');
  const handler = functionSource(source, 'fetchChatGPTFile');

  assert.match(source, /from '\.\/chatgpt-file-fetch\.js'/);
  assert.match(handler, /fetchChatGPTFileExport\(rawUrl\)/);
  assert.doesNotMatch(handler, /arrayBuffer\s*\(/);
  assert.doesNotMatch(handler, /credentials\s*:/);
});
