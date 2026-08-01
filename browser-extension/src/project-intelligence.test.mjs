import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatContextPreviewSummary,
  normalizeMemoryEntry,
  normalizeProjectRecord,
  parseContextRefs,
  parseMemoryTags,
} from './project-intelligence.js';

test('normalizes project and memory records from bridge data', () => {
  const project = normalizeProjectRecord({ id: ' p1 ', name: ' Demo ', root: ' C:\\Demo ' });
  const memory = normalizeMemoryEntry({ id: 'm1', text: ' Keep CSP strict ', tags: ['Security', 'security'] });

  assert.equal(project.id, 'p1');
  assert.equal(project.name, 'Demo');
  assert.equal(project.root, 'C:\\Demo');
  assert.equal(memory.text, 'Keep CSP strict');
  assert.deepEqual(memory.tags, ['security']);
});

test('parses context refs and memory tags deterministically', () => {
  assert.deepEqual(parseContextRefs('src, tests\ndocs'), ['src', 'tests', 'docs']);
  assert.deepEqual(parseMemoryTags('Security, Browser, security'), ['browser', 'security']);
});

test('formats a compact context preview summary', () => {
  const summary = formatContextPreviewSummary({
    totalCharacters: 1250,
    limitCharacters: 5000,
    included: [{ path: 'src/index.ts', truncated: true, characters: 1000, originalCharacters: 2000 }],
    excluded: [{ path: '.env', reason: 'sensitive' }],
  });

  assert.match(summary, /1,250\/5,000/);
  assert.match(summary, /src\/index\.ts/);
  assert.match(summary, /truncated/);
  assert.match(summary, /sensitive:1/);
});
