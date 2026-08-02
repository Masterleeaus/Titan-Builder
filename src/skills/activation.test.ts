import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSkillActivation, createActivationResolver } from './activation.ts';
import type { LoadedSkillPackage } from './loader.js';
import type { TitanSkillManifest } from './manifest.js';

const createSkill = (overrides: Partial<TitanSkillManifest> = {}): LoadedSkillPackage => ({
  manifest: {
    schemaVersion: '1',
    id: 'titan.test.skill',
    name: 'Test Skill',
    version: '1.0.0',
    status: 'stable',
    kind: 'guidance',
    category: 'quality',
    description: 'A test skill',
    owner: 'Test',
    runtimeTargets: ['root'],
    instructions: 'Test instructions',
    inputs: { type: 'object', additionalProperties: false, properties: {} },
    outputs: { type: 'object', additionalProperties: false, properties: {} },
    dependencies: [],
    capabilities: [],
    risk: 'READ',
    approval: 'none',
    tags: [],
    ...overrides,
  },
  packageRoot: '/tmp/test',
  manifestPath: '/tmp/test/manifest.json',
});

test('validates runtime target compatibility', () => {
  const skill = createSkill({ runtimeTargets: ['extension-sidepanel'] });
  const result = validateSkillActivation(skill, { runtimeTarget: 'root' }, [skill]);
  assert.equal(result.available, false);
  assert.match(result.issues[0].message, /runtime target/i);
});

test('accepts compatible runtime targets', () => {
  const skill = createSkill({ runtimeTargets: ['root', 'cli'] });
  const result = validateSkillActivation(skill, { runtimeTarget: 'cli' }, [skill]);
  assert.equal(result.available, true);
  assert.equal(result.status, 'available');
});

test('validates Titan version compatibility', () => {
  const skill = createSkill({
    compatibility: { minTitanVersion: '1.0.0' },
  });
  const result = validateSkillActivation(skill, { runtimeTarget: 'root' }, [skill], '0.5.0');
  assert.equal(result.available, false);
  assert.match(result.issues[0].message, /Titan version/i);
});

test('accepts compatible Titan versions', () => {
  const skill = createSkill({
    compatibility: { minTitanVersion: '0.5.0' },
  });
  const result = validateSkillActivation(skill, { runtimeTarget: 'root' }, [skill], '0.6.0');
  assert.equal(result.available, true);
});

test('validates platform compatibility', () => {
  const skill = createSkill({
    compatibility: { platforms: ['linux', 'macos'] },
  });
  const result = validateSkillActivation(skill, { runtimeTarget: 'root', platform: 'windows' }, [skill]);
  assert.equal(result.available, false);
  assert.match(result.issues[0].message, /platform/i);
});

test('accepts compatible platforms', () => {
  const skill = createSkill({
    compatibility: { platforms: ['linux', 'windows'] },
  });
  const result = validateSkillActivation(skill, { runtimeTarget: 'root', platform: 'windows' }, [skill]);
  assert.equal(result.available, true);
});

test('validates provider compatibility', () => {
  const skill = createSkill({
    compatibility: { providers: ['ChatGPT', 'Claude'] },
  });
  const result = validateSkillActivation(skill, { runtimeTarget: 'root', provider: 'Gemini' }, [skill]);
  assert.equal(result.available, false);
  assert.match(result.issues[0].message, /provider/i);
});

test('accepts compatible providers', () => {
  const skill = createSkill({
    compatibility: { providers: ['ChatGPT', 'Claude'] },
  });
  const result = validateSkillActivation(skill, { runtimeTarget: 'root', provider: 'Claude' }, [skill]);
  assert.equal(result.available, true);
});

test('detects missing dependencies', () => {
  const skill = createSkill({
    dependencies: ['titan.missing.dependency'],
  });
  const result = validateSkillActivation(skill, { runtimeTarget: 'root' }, [skill]);
  assert.equal(result.available, false);
  assert.equal(result.status, 'missing_dependency');
  assert.match(result.issues[0].message, /not available/i);
});

test('validates transitive dependencies', () => {
  const depA = createSkill({ id: 'titan.dep.a', dependencies: ['titan.dep.b'] });
  const depB = createSkill({ id: 'titan.dep.b', dependencies: [] });
  const skill = createSkill({ dependencies: ['titan.dep.a'] });

  const result = validateSkillActivation(skill, { runtimeTarget: 'root' }, [skill, depA, depB]);
  assert.equal(result.available, true);
});

test('detects circular dependencies', () => {
  const depA = createSkill({ id: 'titan.dep.a', dependencies: ['titan.dep.b'] });
  const depB = createSkill({ id: 'titan.dep.b', dependencies: ['titan.dep.a'] });

  const result = validateSkillActivation(depA, { runtimeTarget: 'root' }, [depA, depB]);
  assert.equal(result.available, false);
  assert.match(result.issues[0].message, /circular/i);
});

test('marks deprecated skills with warning', () => {
  const skill = createSkill({
    status: 'deprecated',
    deprecation: { message: 'Use titan.new.skill instead', replacedBy: 'titan.new.skill' },
  });
  const result = validateSkillActivation(skill, { runtimeTarget: 'root' }, [skill]);
  assert.equal(result.available, true);
  assert.equal(result.status, 'deprecated');
  assert.equal(result.deprecationMessage, 'Use titan.new.skill instead');
  assert.match(result.issues[0].message, /Use titan/);
});

test('tracks approval requirements', () => {
  const noApproval = createSkill({ approval: 'none' });
  const explicit = createSkill({ approval: 'explicit' });
  const policy = createSkill({ approval: 'policy' });

  assert.equal(validateSkillActivation(noApproval, { runtimeTarget: 'root' }, [noApproval]).requiresApproval, false);
  assert.equal(validateSkillActivation(explicit, { runtimeTarget: 'root' }, [explicit]).requiresApproval, true);
  assert.equal(validateSkillActivation(policy, { runtimeTarget: 'root' }, [policy]).requiresApproval, true);
});

test('activation resolver validates individual skills', () => {
  const skill = createSkill();
  const resolver = createActivationResolver([skill]);

  const result = resolver.validate('titan.test.skill', { runtimeTarget: 'root' });
  assert.equal(result.available, true);
});

test('activation resolver lists available skills', () => {
  const available = createSkill({ id: 'titan.available', runtimeTargets: ['root'] });
  const unavailable = createSkill({ id: 'titan.unavailable', runtimeTargets: ['extension-sidepanel'] });

  const resolver = createActivationResolver([available, unavailable]);
  const results = resolver.listAvailable({ runtimeTarget: 'root' });

  assert.equal(results.length, 1);
  assert.equal(results[0].manifest.id, 'titan.available');
});

test('activation resolver lists guidance skills', () => {
  const guidance = createSkill({
    id: 'titan.guidance',
    kind: 'guidance',
    instructions: 'Guide me',
  });
  const executable = createSkill({
    id: 'titan.executable',
    kind: 'executable',
    instructions: undefined,
  });

  const resolver = createActivationResolver([guidance, executable]);
  const results = resolver.listGuidanceSkills({ runtimeTarget: 'root' });

  assert.equal(results.length, 1);
  assert.equal(results[0].manifest.id, 'titan.guidance');
});

test('activation resolver resolves skill aliases', () => {
  const skill = createSkill({ aliases: ['test-alias', 'another-alias'] });
  const resolver = createActivationResolver([skill]);

  const byAlias = resolver.validate('test-alias', { runtimeTarget: 'root' });
  assert.equal(byAlias.available, true);
  assert.equal(byAlias.manifest.id, 'titan.test.skill');
});

test('activation resolver returns not found for missing skills', () => {
  const skill = createSkill();
  const resolver = createActivationResolver([skill]);

  const result = resolver.validate('titan.nonexistent', { runtimeTarget: 'root' });
  assert.equal(result.available, false);
  assert.equal(result.status, 'unavailable');
  assert.match(result.issues[0].message, /not found/i);
});
