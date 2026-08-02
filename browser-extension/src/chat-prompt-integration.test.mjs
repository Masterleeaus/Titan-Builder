import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const bootstrap = await readFile(new URL('./chat-prompt-bootstrap.js', import.meta.url), 'utf8');
const routing = await readFile(new URL('./chat-prompt-routing.js', import.meta.url), 'utf8');
const envelope = await readFile(new URL('./chat-prompt-envelope.js', import.meta.url), 'utf8');

test('normal-chat routing bootstrap loads after the existing Work content runtime', () => {
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('src/chat-prompt-bootstrap.js'));
  assert.ok(scripts.indexOf('src/chat-prompt-bootstrap.js') > scripts.indexOf('src/content-script.js'));
  assert.match(bootstrap, /chrome\.runtime\.getURL\('src\/chat-prompt-routing\.js'\)/);
  assert.match(bootstrap, /import\(moduleUrl\)/);
});

test('shared routing modules and canonical prompt bodies are exposed only to supported AI hosts', () => {
  assert.equal(manifest.web_accessible_resources.length, 1);
  const entry = manifest.web_accessible_resources[0];
  for (const resource of [
    'src/chat-prompt-routing.js',
    'src/chat-prompt-envelope.js',
    'src/prompt-router.js',
    'src/prompt-catalog.js',
    'src/generated/prompt-catalog.js',
    'prompt-library/*',
  ]) assert.ok(entry.resources.includes(resource), `missing ${resource}`);
  assert.equal(entry.use_dynamic_url, true);
  assert.ok(entry.matches.length >= 10);
  assert.ok(!entry.matches.includes('<all_urls>'));
  assert.ok(entry.matches.every((match) => match.startsWith('https://')));
});

test('chat interceptor handles provider clicks, Enter, and form submits without replacing Work execution', () => {
  assert.match(routing, /addEventListener\('click',[\s\S]*true\)/);
  assert.match(routing, /addEventListener\('keydown',[\s\S]*true\)/);
  assert.match(routing, /addEventListener\('submit',[\s\S]*true\)/);
  assert.match(routing, /prepareChatPrompt/);
  assert.match(routing, /getRuntimePromptCatalog/);
  assert.match(routing, /resolvePromptBody/);
  assert.doesNotMatch(routing, /workspace\/runs|approve|applyOperation/);
});

test('chat controls provide Auto, Manual, and Off modes and preserve normal conversation limits', () => {
  assert.match(routing, /Auto prompts/);
  assert.match(routing, /Manual prompt/);
  assert.match(routing, /Prompts off/);
  assert.match(envelope, /Continue the ordinary provider conversation normally/);
  assert.match(envelope, /do not impose Work-mode reply or continuation limits/);
  assert.doesNotMatch(envelope, /current registered project/i);
});

test('normal-chat routing source remains CSP-safe', () => {
  for (const source of [bootstrap, routing, envelope]) {
    assert.doesNotMatch(source, /\beval\s*\(/);
    assert.doesNotMatch(source, /new\s+Function\s*\(/);
    assert.doesNotMatch(source, /innerHTML\s*=/);
  }
});
