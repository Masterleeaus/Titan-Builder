import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolKnowledgeRecords } from './knowledge.ts';

test('exports deterministic database-agnostic knowledge records for every tool', () => {
  const records = createToolKnowledgeRecords();
  const runtimeIds = records.map((record) => record.runtimeId);

  assert.deepEqual(runtimeIds, [...runtimeIds].sort());
  assert.ok(runtimeIds.includes('git.status'));
  assert.ok(runtimeIds.includes('git.show'));
  assert.equal(new Set(runtimeIds).size, runtimeIds.length);

  for (const record of records) {
    assert.match(record.id, /^titan\.tool\./u);
    assert.ok(record.summary.length > 0);
    assert.ok(record.keywords.length > 0);
    assert.ok(record.category.length > 0);
    assert.ok(record.version.length > 0);
    assert.ok(record.compatibility.platforms.length > 0);
    assert.equal(Object.hasOwn(record, 'executable'), false);
    assert.equal(Object.hasOwn(record, 'resolver'), false);
    assert.equal(Object.hasOwn(record, 'cwd'), false);
  }
});

test('knowledge records and nested relationship arrays are immutable', () => {
  const records = createToolKnowledgeRecords();
  const first = records[0];
  assert.ok(first);
  assert.equal(Object.isFrozen(records), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.relatedTools), true);
  assert.equal(Object.isFrozen(first.compatibility), true);

  assert.throws(() => {
    (records as unknown as Array<unknown>).push({});
  }, TypeError);
  assert.throws(() => {
    (first.keywords as unknown as string[]).push('unsafe');
  }, TypeError);
});
