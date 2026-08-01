import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('background routes explicit ChatGPT scans and file fetches', async () => {
  const background = await readFile(new URL('./background.js', import.meta.url), 'utf8');
  assert.match(background, /OPENBROWSER_SCAN_CHATGPT/);
  assert.match(background, /OPENBROWSER_CHATGPT_SCAN/);
  assert.match(background, /OPENBROWSER_FETCH_CHATGPT_FILE/);
  assert.match(background, /fetchChatGPTFile/);
  assert.match(background, /MAX_CHATGPT_EXPORT_BYTES/);
});

test('content script exposes visible ChatGPT scans and size-capped file fetching', async () => {
  const content = await readFile(new URL('./content-script.js', import.meta.url), 'utf8');
  assert.match(content, /OpenBrowserChatGPTTools/);
  assert.match(content, /OPENBROWSER_CHATGPT_SCAN/);
  assert.match(content, /OPENBROWSER_CHATGPT_FETCH_FILE/);
  assert.match(content, /MAX_CHATGPT_EXPORT_BYTES/);
  assert.match(content, /credentials:\s*['"]include['"]/);
});

test('workspace instructions and capped auto-continue are wired into prompt and job delivery', async () => {
  const [background, content] = await Promise.all([
    readFile(new URL('./background.js', import.meta.url), 'utf8'),
    readFile(new URL('./content-script.js', import.meta.url), 'utf8'),
  ]);
  assert.match(background, /composeWorkspacePrompt/);
  assert.match(background, /activeProfileId/);
  assert.match(background, /autoContinueEnabled/);
  assert.match(content, /runAutoContinue/);
  assert.match(content, /autoContinueMax/);
  assert.match(content, /findNativeContinueButton/);
  assert.match(content, /waitForContinuationChange/);
});
