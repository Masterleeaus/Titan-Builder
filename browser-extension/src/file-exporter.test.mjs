import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMarkdownExport,
  createZipBytes,
  sanitizeExportName,
  selectExportItems,
} from './file-exporter.js';

test('sanitizes unsafe export names while preserving useful extensions', () => {
  assert.equal(sanitizeExportName('../My report?.md'), 'My-report.md');
  assert.equal(sanitizeExportName('  '), 'openbrowser-export');
  assert.equal(sanitizeExportName('a'.repeat(200) + '.txt').length <= 120, true);
});

test('selects one, selected, or all export items', () => {
  const items = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ];
  assert.deepEqual(selectExportItems(items, { mode: 'one', focusId: 'b' }).map((item) => item.id), ['b']);
  assert.deepEqual(selectExportItems(items, { mode: 'selected', selectedIds: ['a', 'c'] }).map((item) => item.id), ['a', 'c']);
  assert.equal(selectExportItems(items, { mode: 'all' }).length, 3);
});

test('builds markdown containing replies and file metadata without inventing content', () => {
  const markdown = buildMarkdownExport([
    { type: 'reply', name: 'Assistant reply 1', text: 'Use a focused test.', url: 'https://chatgpt.com/c/1' },
    { type: 'file', name: 'report.pdf', url: 'https://files.example/report.pdf', size: 1200 },
  ], { title: 'Session export' });
  assert.match(markdown, /^# Session export/m);
  assert.match(markdown, /Use a focused test\./);
  assert.match(markdown, /report\.pdf/);
  assert.match(markdown, /https:\/\/files\.example\/report\.pdf/);
  assert.doesNotMatch(markdown, /Downloaded file content/);
});

test('creates a valid store-only zip with supplied filenames and bytes', () => {
  const zip = createZipBytes([
    { name: 'reply-1.md', data: new TextEncoder().encode('# Reply') },
    { name: 'files/report.txt', data: new TextEncoder().encode('report') },
  ]);
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  const text = new TextDecoder().decode(zip);
  assert.match(text, /reply-1\.md/);
  assert.match(text, /files\/report\.txt/);
  assert.equal(zip.at(-22), 0x50);
  assert.equal(zip.at(-21), 0x4b);
});
