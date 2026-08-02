import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_AGENT_PROFILES,
  BUILTIN_SKILLS,
  composeWorkspacePrompt,
  normalizeAgentProfile,
  normalizeSkill,
  resolveWorkspaceContext,
} from './workspace-library.js';

test('built-in skills and profiles provide stable unique ids', () => {
  assert.ok(BUILTIN_SKILLS.length >= 6);
  assert.ok(BUILTIN_AGENT_PROFILES.length >= 4);
  assert.equal(new Set(BUILTIN_SKILLS.map((item) => item.id)).size, BUILTIN_SKILLS.length);
  assert.equal(new Set(BUILTIN_AGENT_PROFILES.map((item) => item.id)).size, BUILTIN_AGENT_PROFILES.length);
});

test('normalizes custom skills and profiles with trimmed instruction text', () => {
  assert.deepEqual(
    normalizeSkill({
      title: '  Security Review ',
      description: ' Check boundaries ',
      instructions: '  Review trust boundaries.  ',
      tags: 'security, browser, security',
    }, () => 'skill-id'),
    {
      id: 'skill-id',
      title: 'Security Review',
      description: 'Check boundaries',
      instructions: 'Review trust boundaries.',
      tags: ['security', 'browser'],
      custom: true,
    },
  );

  assert.deepEqual(
    normalizeAgentProfile({
      name: '  Test Engineer ',
      role: ' Quality ',
      instructions: '  Prefer focused regression tests. ',
      skillIds: ['testing', 'testing', 'debugging'],
    }, () => 'agent-id'),
    {
      id: 'agent-id',
      name: 'Test Engineer',
      role: 'Quality',
      instructions: 'Prefer focused regression tests.',
      skillIds: ['testing', 'debugging'],
      custom: true,
    },
  );
});

test('resolves active agent and skills and composes instructions once', () => {
  const context = resolveWorkspaceContext({
    skills: [
      { id: 'debugging', title: 'Debugging', instructions: 'Trace the fault before editing.' },
      { id: 'testing', title: 'Testing', instructions: 'Add a regression test.' },
    ],
    profiles: [
      {
        id: 'fixer',
        name: 'Fixer',
        role: 'Repair agent',
        instructions: 'Make the smallest coherent fix.',
        skillIds: ['debugging'],
      },
    ],
    activeSkillIds: ['testing'],
    activeProfileId: 'fixer',
  });

  assert.equal(context.profile.id, 'fixer');
  assert.deepEqual(context.skills.map((item) => item.id), ['debugging', 'testing']);

  const composed = composeWorkspacePrompt('Repair the failing build.', context);
  assert.match(composed, /OpenBrowser Active Agent Profile/);
  assert.match(composed, /Fixer/);
  assert.match(composed, /Trace the fault before editing/);
  assert.match(composed, /Add a regression test/);
  assert.equal(composed.match(/Repair the failing build\./g)?.length, 1);
});
