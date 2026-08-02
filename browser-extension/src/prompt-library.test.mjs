import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyTemplateVariables,
  filterPrompts,
  normalizeCustomPrompt,
  parseTemplateVariables,
} from './prompt-library.js';
import {
  composeRoutedPrompt,
  rankPrompts,
  routePromptRequest,
} from './prompt-router.js';
import {
  getRuntimePromptCatalog,
  loadCanonicalPromptBody,
} from './prompt-catalog.js';

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

const routingPrompts = [
  {
    id: 'TB-PROMPT-TZ-ARCH-001',
    title: 'Titan Zero and WorkCore Authority Boundary Audit',
    category: 'Titan Zero / Architecture and Governance',
    purpose: 'Audit authority boundaries so WorkCore remains the operational system of record.',
    description: 'Find duplicated authority, direct writes, unsafe projections, and bypass paths.',
    tags: ['titan-zero', 'workcore', 'authority-boundary', 'system-of-record'],
    routingIntents: ['audit titan zero workcore authority', 'find duplicate operational records'],
    negativeRoutingIntents: ['create customer job', 'send invoice'],
    workModes: ['ask', 'agent'],
  },
  {
    id: 'TB-PROMPT-FIELD-ARCH-001',
    title: 'Home and Field-Service Platform Architecture Audit',
    category: 'Home and Field Service / Platform Architecture',
    purpose: 'Audit shared home and field-service software architecture and runtime reachability.',
    description: 'Review job, scheduling, mobile, offline, security, integration, and test architecture.',
    tags: ['field-service', 'home-services', 'platform-architecture', 'mobile', 'offline'],
    routingIntents: ['audit field service platform architecture', 'review field worker mobile architecture'],
    negativeRoutingIntents: ['dispatch cleaner today', 'create live booking'],
    workModes: ['agent'],
  },
  {
    id: 'systematic-debug',
    title: 'Systematic Bug Debugger',
    category: 'Debugging',
    purpose: 'Reproduce a defect and identify the smallest tested root-cause fix.',
    description: 'Trace observed and expected behaviour before editing.',
    tags: ['root-cause', 'tests', 'regression'],
    routingIntents: ['debug failing code', 'find root cause'],
    negativeRoutingIntents: [],
    workModes: ['ask', 'agent'],
    content: 'Debug this problem systematically.',
  },
];

test('rankPrompts honours exact IDs and exact titles before lexical scoring', () => {
  const byId = routePromptRequest('Use TB-PROMPT-TZ-ARCH-001 on this repository', routingPrompts);
  assert.equal(byId.status, 'selected');
  assert.equal(byId.selected.id, 'TB-PROMPT-TZ-ARCH-001');
  assert.equal(byId.reason, 'explicit-id');

  const byTitle = routePromptRequest('Titan Zero and WorkCore Authority Boundary Audit', routingPrompts);
  assert.equal(byTitle.status, 'selected');
  assert.equal(byTitle.selected.id, 'TB-PROMPT-TZ-ARCH-001');
  assert.equal(byTitle.reason, 'exact-title');
});

test('rankPrompts weights routing intents, title, purpose, tags, and category', () => {
  const ranked = rankPrompts(
    'Audit whether Titan Zero duplicates WorkCore operational records and bypasses authority boundaries',
    routingPrompts,
    { mode: 'agent' },
  );
  assert.equal(ranked[0].prompt.id, 'TB-PROMPT-TZ-ARCH-001');
  assert.equal(ranked[0].score >= 28, true);
  assert.equal(ranked[0].evidence.some((item) => item.type === 'routing-intent'), true);
});

test('negative intents reduce routing scores and work modes exclude incompatible prompts', () => {
  const liveJob = rankPrompts('Create customer job and dispatch cleaner today', routingPrompts, { mode: 'agent' });
  const authority = liveJob.find((item) => item.prompt.id === 'TB-PROMPT-TZ-ARCH-001');
  assert.equal(authority.score < 0, true);

  const askRanking = rankPrompts('Audit the field service platform architecture', routingPrompts, { mode: 'ask' });
  assert.equal(askRanking.some((item) => item.prompt.id === 'TB-PROMPT-FIELD-ARCH-001'), false);
});

test('routePromptRequest distinguishes selected, ambiguous, none, manual, and off results', () => {
  const selected = routePromptRequest(
    'Audit Titan Zero and WorkCore authority boundaries and duplicated operational records',
    routingPrompts,
    { mode: 'agent' },
  );
  assert.equal(selected.status, 'selected');
  assert.equal(selected.selected.id, 'TB-PROMPT-TZ-ARCH-001');
  assert.equal(selected.score >= 28, true);

  const closePrompts = [
    { ...routingPrompts[0], id: 'one', title: 'Runtime Architecture Audit', routingIntents: ['audit runtime architecture'] },
    { ...routingPrompts[1], id: 'two', title: 'Platform Architecture Audit', routingIntents: ['audit platform architecture'], workModes: ['ask', 'agent'] },
  ];
  const ambiguous = routePromptRequest('Audit runtime platform architecture', closePrompts, { mode: 'agent' });
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.candidates.length, 2);

  const none = routePromptRequest('Explain the colour blue', routingPrompts, { mode: 'ask' });
  assert.equal(none.status, 'none');

  const manual = routePromptRequest('Anything', routingPrompts, {
    routingMode: 'manual',
    manualPromptId: 'systematic-debug',
    mode: 'agent',
  });
  assert.equal(manual.status, 'selected');
  assert.equal(manual.selected.id, 'systematic-debug');
  assert.equal(manual.reason, 'manual');

  const off = routePromptRequest('Audit Titan Zero', routingPrompts, { routingMode: 'off' });
  assert.equal(off.status, 'off');
  assert.equal(off.selected, null);
});

test('runtime catalog combines canonical records and built-in cards without duplicating IDs', () => {
  const catalog = getRuntimePromptCatalog({
    canonical: [{
      id: 'TB-PROMPT-FOUND-001',
      title: 'Repository Architecture Discovery',
      path: 'prompt-library/foundation/found-001.md',
      tags: ['architecture'],
    }],
    builtins: [{
      id: 'systematic-debug',
      title: 'Systematic Bug Debugger',
      content: 'Debug it',
      tags: ['debugging'],
    }],
  });
  assert.deepEqual(catalog.map((item) => item.id), ['systematic-debug', 'TB-PROMPT-FOUND-001']);
  assert.equal(catalog[0].sourceType, 'builtin');
  assert.equal(catalog[1].sourceType, 'canonical');
  assert.throws(
    () => getRuntimePromptCatalog({ canonical: [{ id: 'same', title: 'One', path: 'one.md' }], builtins: [{ id: 'same', title: 'Two', content: 'two' }] }),
    /duplicate/i,
  );
});

test('loadCanonicalPromptBody validates the fetched metadata ID', async () => {
  const record = {
    id: 'TB-PROMPT-FOUND-006',
    title: 'Prompt Library Metadata Index Generation',
    path: 'prompt-library/foundation/found-006.md',
    sourceType: 'canonical',
  };
  const body = await loadCanonicalPromptBody(record, async () => '# Prompt\n\n## Metadata\n\n| Field | Value |\n|---|---|\n| ID | `TB-PROMPT-FOUND-006` |');
  assert.match(body, /TB-PROMPT-FOUND-006/);
  await assert.rejects(
    () => loadCanonicalPromptBody(record, async () => '# Prompt\n\n## Metadata\n\n| Field | Value |\n|---|---|\n| ID | `TB-PROMPT-OTHER-001` |'),
    /does not match/i,
  );
});

test('composeRoutedPrompt preserves the original request and selected body', () => {
  const originalRequest = 'Audit Titan Zero versus WorkCore. Keep this sentence exactly: ${literal}.';
  const result = composeRoutedPrompt({
    request: originalRequest,
    prompt: routingPrompts[0],
    body: '# Canonical Prompt\n\nFollow the authority audit.',
    route: { score: 72, margin: 19, reason: 'auto' },
  });
  assert.match(result, /TB-PROMPT-TZ-ARCH-001/);
  assert.equal(result.includes(originalRequest), true);
  assert.match(result, /Follow the authority audit/);
  assert.match(result, /return a focused question or BLOCKED/i);
});
