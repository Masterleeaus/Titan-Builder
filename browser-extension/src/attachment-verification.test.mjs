import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadApi() {
  const source = await readFile(new URL('./attachment-verification.js', import.meta.url), 'utf8');
  const sandbox = {};
  vm.runInNewContext(`${source}\n;globalThis.__attachmentApi = OpenBrowserAttachmentVerification;`, sandbox);
  return sandbox.__attachmentApi;
}

test('attachment matching rejects generic txt signals and requires exact filename or unique marker', async () => {
  const api = await loadApi();
  const expected = api.createAttachmentExpectation('openbrowser-prompt-session-abc123.txt', 1200);

  assert.equal(api.previewEvidenceKey('txt', expected), null);
  assert.equal(api.previewEvidenceKey('.txt', expected), null);
  assert.equal(api.previewEvidenceKey('uploaded file', expected), null);
  assert.equal(api.previewEvidenceKey('unrelated-notes.txt', expected), null);
  assert.equal(
    api.previewEvidenceKey('openbrowser-prompt-session-abc123.txt', expected),
    'filename:openbrowser-prompt-session-abc123.txt',
  );
  assert.equal(
    api.previewEvidenceKey('Upload complete: session-abc123', expected),
    'marker:session-abc123',
  );
});

test('attachment success requires new matching evidence after upload', async () => {
  const api = await loadApi();
  const before = {
    keys: new Set(['filename:unrelated.txt']),
    nodes: new Set(['old-node']),
  };

  assert.equal(api.hasNewAttachmentEvidence(before, {
    keys: new Set(['filename:unrelated.txt']),
    nodes: new Set(['old-node']),
  }), false);

  assert.equal(api.hasNewAttachmentEvidence(before, {
    keys: new Set(['filename:unrelated.txt', 'marker:session-abc123']),
    nodes: new Set(['old-node', 'new-node']),
  }), true);

  assert.equal(api.hasNewAttachmentEvidence({
    keys: new Set(['marker:session-abc123']),
    nodes: new Set(['old-node']),
  }, {
    keys: new Set(['marker:session-abc123']),
    nodes: new Set(['new-node']),
  }), true);
});

test('exact selected-file evidence includes normalized filename and byte size', async () => {
  const api = await loadApi();
  const expected = api.createAttachmentExpectation('Folder\\OPENBROWSER-PROMPT-Session-ABC123.txt', 1200);

  assert.equal(api.fileEvidenceKey({ name: 'openbrowser-prompt-session-abc123.txt', size: 1200 }, expected),
    'file:openbrowser-prompt-session-abc123.txt:1200');
  assert.equal(api.fileEvidenceKey({ name: 'openbrowser-prompt-session-abc123.txt', size: 1199 }, expected), null);
  assert.equal(api.fileEvidenceKey({ name: 'other.txt', size: 1200 }, expected), null);
});

test('composer verification uses normalized equality rather than approximate length', async () => {
  const api = await loadApi();
  const expected = 'Read the attached prompt.\nFollow every instruction.';

  assert.equal(api.composerContentMatches(
    'Read the attached prompt.\r\nFollow every instruction.\u200b',
    expected,
  ), true);
  assert.equal(api.composerContentMatches(
    'Stale composer content with almost exactly the same character length',
    expected,
  ), false);
  assert.equal(api.composerContentMatches(`${expected} extra stale text`, expected), false);
  assert.equal(api.composerContentMatches(expected.slice(0, -2), expected), false);
});

test('content-script wiring requires a new exact preview and exact composer text', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const content = await readFile(new URL('./content-script.js', import.meta.url), 'utf8');
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js ?? []);
  const verifierIndex = scripts.indexOf('src/attachment-verification.js');
  const contentIndex = scripts.indexOf('src/content-script.js');

  assert.ok(verifierIndex >= 0 && verifierIndex < contentIndex);
  assert.match(content, /captureAttachmentPreviewState/);
  assert.match(content, /hasNewAttachmentEvidence/);
  assert.match(content, /composerContentMatches/);
  assert.doesNotMatch(content, /text\.includes\(['"]\.txt['"]\)/);
  assert.doesNotMatch(content, /actual\.length\s*>=\s*expected\.length\s*\*\s*0\.85/);
});
