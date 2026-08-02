import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildPromptCatalog,
  normalizeLineEndings,
  parsePromptDocument,
  renderPromptCatalog,
} from './generate-prompt-catalog.mjs';

const SAMPLE = `# Example Prompt

## Metadata

| Field | Value |
|---|---|
| ID | \`TB-PROMPT-TEST-001\` |
| Name | Example Test Prompt |
| Version | \`1.2.3\` |
| Status | Stable |
| Category | Testing |
| Tags | tests, regression |
| Dependencies | \`TB-PROMPT-FOUND-003\` |
| Compatible Providers | ChatGPT, Claude |
| Related Prompts | \`TB-PROMPT-TEST-002\` |
| Routing Intents | repair failing tests; debug regression |
| Negative Routing Intents | run live production deployment |
| Work Modes | agent |
| Routing Risk | elevated |

## Purpose

Repair one confirmed failing test through evidence-based root-cause analysis.

## Description

This prompt audits and repairs one bounded test failure.

## Change Log

### Version 1.2.3
`;

test('parsePromptDocument extracts canonical and routing metadata', () => {
  const record = parsePromptDocument(SAMPLE, 'testing/tb-prompt-test-001-example-test-prompt.md');
  assert.deepEqual(record, {
    id: 'TB-PROMPT-TEST-001',
    title: 'Example Test Prompt',
    version: '1.2.3',
    status: 'Stable',
    category: 'Testing',
    tags: ['tests', 'regression'],
    dependencies: ['TB-PROMPT-FOUND-003'],
    compatibleProviders: ['ChatGPT', 'Claude'],
    relatedPrompts: ['TB-PROMPT-TEST-002'],
    purpose: 'Repair one confirmed failing test through evidence-based root-cause analysis.',
    description: 'This prompt audits and repairs one bounded test failure.',
    path: 'prompt-library/testing/tb-prompt-test-001-example-test-prompt.md',
    routingIntents: ['repair failing tests', 'debug regression'],
    negativeRoutingIntents: ['run live production deployment'],
    workModes: ['agent'],
    routingRisk: 'elevated',
  });
});

test('parsePromptDocument applies safe routing defaults', () => {
  const source = SAMPLE
    .replace('| Routing Intents | repair failing tests; debug regression |\n', '')
    .replace('| Negative Routing Intents | run live production deployment |\n', '')
    .replace('| Work Modes | agent |\n', '')
    .replace('| Routing Risk | elevated |\n', '');
  const record = parsePromptDocument(source, 'testing/tb-prompt-test-001-example-test-prompt.md');
  assert.deepEqual(record.routingIntents, []);
  assert.deepEqual(record.negativeRoutingIntents, []);
  assert.deepEqual(record.workModes, ['ask', 'agent']);
  assert.equal(record.routingRisk, 'standard');
});

test('buildPromptCatalog sorts records and rejects duplicate IDs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prompt-catalog-'));
  try {
    await mkdir(path.join(root, 'testing'), { recursive: true });
    await writeFile(path.join(root, 'testing', 'tb-prompt-test-001-example-test-prompt.md'), SAMPLE);
    const second = SAMPLE
      .replaceAll('TB-PROMPT-TEST-001', 'TB-PROMPT-ARCH-001')
      .replace('Example Test Prompt', 'Architecture Prompt');
    await writeFile(path.join(root, 'testing', 'tb-prompt-arch-001-architecture-prompt.md'), second);
    const records = await buildPromptCatalog(root);
    assert.deepEqual(records.map((item) => item.id), ['TB-PROMPT-ARCH-001', 'TB-PROMPT-TEST-001']);

    await writeFile(path.join(root, 'testing', 'tb-prompt-test-001-duplicate.md'), SAMPLE);
    await assert.rejects(() => buildPromptCatalog(root), /duplicate prompt id/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('renderPromptCatalog is deterministic and line-ending checks are portable', () => {
  const rendered = renderPromptCatalog([{ id: 'TB-PROMPT-TEST-001', title: 'Test' }]);
  assert.match(rendered, /GENERATED_PROMPT_CATALOG/);
  assert.match(rendered, /TB-PROMPT-TEST-001/);
  assert.equal(normalizeLineEndings('a\r\nb\r'), 'a\nb\n');
  assert.equal(rendered, renderPromptCatalog([{ id: 'TB-PROMPT-TEST-001', title: 'Test' }]));
});
