import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyTemplateVariables,
  filterPrompts,
  normalizeCustomPrompt,
  parseTemplateVariables,
} from './prompt-library.js';

test('parseTemplateVariables returns unique variables and defaults in encounter order', () => {
  assert.deepEqual(
    parseTemplateVariables('Fix ${file} for ${framework:Svelte} and re-check ${file}.'),
    [
      { name: 'file', defaultValue: '' },
      { name: 'framework', defaultValue: 'Svelte' },
    ],
  );
});

test('applyTemplateVariables replaces defaulted and plain variables without regex leakage', () => {
  const template = 'Review ${file.name:index.ts} in ${path+root:src/}.';
  assert.equal(
    applyTemplateVariables(template, {
      'file.name': 'worker.ts',
      'path+root': 'src/background/',
    }),
    'Review worker.ts in src/background/.',
  );
});

test('filterPrompts searches title, description, tags, and category', () => {
  const prompts = [
    {
      id: 'audit',
      title: 'Deep Extension Audit',
      description: 'Trace runtime and security boundaries',
      category: 'Audit',
      tags: ['security', 'manifest-v3'],
      content: 'Audit the project',
    },
    {
      id: 'test',
      title: 'Focused Test Repair',
      description: 'Repair failing tests',
      category: 'Testing',
      tags: ['vitest'],
      content: 'Fix tests',
    },
  ];

  assert.deepEqual(filterPrompts(prompts, 'manifest', 'all').map((item) => item.id), ['audit']);
  assert.deepEqual(filterPrompts(prompts, '', 'Testing').map((item) => item.id), ['test']);
  assert.deepEqual(filterPrompts(prompts, 'security', 'Testing'), []);
});

test('normalizeCustomPrompt trims safe values and creates a stable prompt shape', () => {
  const prompt = normalizeCustomPrompt({
    title: '  Repair Runtime  ',
    description: '  Trace and fix it  ',
    category: ' Debugging ',
    tags: [' runtime ', 'security', 'runtime'],
    content: '  Inspect ${path:src/} and repair confirmed defects.  ',
  }, () => 'generated-id');

  assert.deepEqual(prompt, {
    id: 'generated-id',
    title: 'Repair Runtime',
    description: 'Trace and fix it',
    category: 'Debugging',
    tags: ['runtime', 'security'],
    content: 'Inspect ${path:src/} and repair confirmed defects.',
    custom: true,
  });
});

test('normalizeCustomPrompt rejects missing title or content', () => {
  assert.throws(() => normalizeCustomPrompt({ title: ' ', content: 'x' }), /title/i);
  assert.throws(() => normalizeCustomPrompt({ title: 'Valid', content: ' ' }), /content/i);
});
