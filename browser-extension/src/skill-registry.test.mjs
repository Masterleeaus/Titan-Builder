import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_SKILLS,
  createExtensionSkillRegistry,
  resolveBuiltinSkillId,
} from './skill-registry.js';

const LEGACY_TO_CANONICAL = Object.freeze({
  debugging: 'titan.guidance.systematic-debugging',
  testing: 'titan.guidance.test-driven-development',
  security: 'titan.guidance.extension-security',
  architecture: 'titan.guidance.architecture-review',
  git: 'titan.guidance.git-discipline',
  performance: 'titan.guidance.browser-performance',
});

test('resolves every built-in legacy id to a canonical guidance skill', () => {
  for (const [legacyId, canonicalId] of Object.entries(LEGACY_TO_CANONICAL)) {
    assert.equal(resolveBuiltinSkillId(legacyId), canonicalId);
    assert.ok(BUILTIN_SKILLS.some((skill) => skill.id === canonicalId), `missing ${canonicalId}`);
    assert.equal(BUILTIN_SKILLS.some((skill) => skill.id === legacyId), false);
  }
});

test('rejects generated alias collisions', () => {
  assert.throws(
    () => createExtensionSkillRegistry({
      generatedSkills: [
        { id: 'titan.guidance.one', title: 'One', instructions: 'One', aliases: ['shared'], kind: 'guidance' },
        { id: 'titan.guidance.two', title: 'Two', instructions: 'Two', aliases: ['shared'], kind: 'guidance' },
      ],
    }),
    /alias.*shared/i,
  );
});
