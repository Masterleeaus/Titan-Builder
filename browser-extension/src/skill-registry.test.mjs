import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_SKILLS,
  createExtensionSkillRegistry,
  resolveBuiltinSkillId,
} from './skill-registry.js';

test('resolves the legacy debugging id to the canonical skill', () => {
  assert.equal(resolveBuiltinSkillId('debugging'), 'titan.guidance.systematic-debugging');
  assert.equal(
    BUILTIN_SKILLS.find((skill) => skill.id === 'titan.guidance.systematic-debugging')?.title,
    'Systematic Debugging',
  );
});

test('preserves unmigrated legacy guidance skills', () => {
  for (const id of ['testing', 'security', 'architecture', 'git', 'performance']) {
    assert.ok(BUILTIN_SKILLS.some((skill) => skill.id === id), `missing ${id}`);
  }
});

test('rejects generated alias collisions', () => {
  assert.throws(
    () => createExtensionSkillRegistry({
      generatedSkills: [
        { id: 'titan.guidance.one', title: 'One', instructions: 'One', aliases: ['shared'], kind: 'guidance' },
        { id: 'titan.guidance.two', title: 'Two', instructions: 'Two', aliases: ['shared'], kind: 'guidance' },
      ],
      legacySkills: [],
    }),
    /alias.*shared/i,
  );
});
