import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_AGENT_PROFILES,
  BUILTIN_SKILLS,
  resolveWorkspaceContext,
} from './workspace-library.js';

test('legacy profile IDs activate canonical migrated skills', () => {
  const context = resolveWorkspaceContext({
    skills: BUILTIN_SKILLS,
    profiles: BUILTIN_AGENT_PROFILES,
    activeProfileId: 'coding-agent',
  });

  assert.ok(context.skills.some((skill) => skill.id === 'titan.guidance.systematic-debugging'));
  assert.ok(context.skills.some((skill) => skill.id === 'titan.guidance.test-driven-development'));
  assert.ok(context.skills.some((skill) => skill.id === 'titan.guidance.git-discipline'));
  assert.equal(
    context.skills.some((skill) => ['debugging', 'testing', 'git'].includes(skill.id)),
    false,
  );
});
