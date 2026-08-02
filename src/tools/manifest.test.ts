import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToolManifest, validateToolManifest } from './manifest.ts';

function validManifest() {
  return {
    schemaVersion: '1',
    id: 'titan.tool.git.status',
    runtimeId: 'git.status',
    aliases: ['git.state'],
    name: 'Git Status',
    purpose: 'Read repository status.',
    category: 'git',
    responsibilities: ['Read concise branch and working-tree state.'],
    inputs: { type: 'object', properties: {}, additionalProperties: false },
    outputs: { type: 'object', properties: { stdout: { type: 'string' } } },
    permissions: ['process.execute', 'git.read'],
    dependencies: [],
    servicesUsed: ['git-runtime', 'workspace-manager'],
    commands: ['git status --short --branch'],
    configuration: ['No configuration required.'],
    securityConsiderations: ['Execution uses a fixed command with shell mode disabled.'],
    failureHandling: ['Invalid arguments fail before execution.'],
    validation: ['Arguments and manifest fields are validated.'],
    tests: ['src/tools/registry.test.ts'],
    documentation: ['README.md'],
    examples: [{ title: 'Read status', tool: 'git.status', args: [] }],
    version: '1.0.0',
    status: 'stable',
    owner: 'Titan Builder',
    risk: 'READ',
    approval: 'none',
    compatibility: {
      minTitanVersion: '0.5.0',
      node: '>=22',
      platforms: ['linux', 'windows', 'macos'],
    },
    knowledge: {
      summary: 'Read repository status.',
      keywords: ['git', 'status'],
      relatedTools: ['git.diff'],
      relatedAgents: ['Titan Builder coding agent'],
      relatedSkills: ['repository inspection'],
      relatedWorkflows: ['operation preview and apply'],
    },
  };
}

test('parses and deeply freezes a complete production tool manifest', () => {
  const manifest = parseToolManifest(validManifest());
  assert.equal(manifest.runtimeId, 'git.status');
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.examples), true);
  assert.equal(Object.isFrozen(manifest.knowledge), true);
  assert.throws(() => {
    (manifest.permissions as unknown as string[]).push('network.write');
  }, TypeError);
});

test('rejects malformed identifiers, versions, and non-object schemas', () => {
  const input = validManifest();
  input.id = 'git.status';
  input.runtimeId = 'Git Status';
  input.version = '1';
  input.inputs = { type: 'string' };
  input.outputs = { type: 'array' };

  const result = validateToolManifest(input);
  assert.equal(result.success, false);
  if (!result.success) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
    assert.match(detail, /id:/u);
    assert.match(detail, /runtimeId:/u);
    assert.match(detail, /version:/u);
    assert.match(detail, /inputs:/u);
    assert.match(detail, /outputs:/u);
  }
});

test('rejects duplicate declarations, aliases to self, and dependencies on self', () => {
  const input = validManifest();
  input.aliases = ['git.status', 'git.state', 'git.state'];
  input.dependencies = ['git.status', 'git.diff', 'git.diff'];
  input.permissions = ['git.read', 'git.read'];

  const result = validateToolManifest(input);
  assert.equal(result.success, false);
  if (!result.success) {
    const detail = result.issues.map((issue) => issue.message).join('\n');
    assert.match(detail, /aliases must be unique/u);
    assert.match(detail, /cannot alias its runtime ID/u);
    assert.match(detail, /dependencies must be unique/u);
    assert.match(detail, /cannot depend on itself/u);
    assert.match(detail, /permissions must be unique/u);
  }
});

test('requires approval for high-side-effect tools', () => {
  const input = validManifest();
  input.risk = 'PUBLISH';
  input.approval = 'none';

  const result = validateToolManifest(input);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.issues.map((issue) => issue.message).join('\n'), /require explicit or policy approval/u);
  }
});

test('requires complete documentation and operational specification fields', () => {
  const input = validManifest();
  input.responsibilities = [];
  input.securityConsiderations = [];
  input.failureHandling = [];
  input.validation = [];
  input.tests = [];
  input.documentation = [];
  input.examples = [];

  const result = validateToolManifest(input);
  assert.equal(result.success, false);
  if (!result.success) {
    const paths = new Set(result.issues.map((issue) => issue.path));
    for (const field of [
      'responsibilities',
      'securityConsiderations',
      'failureHandling',
      'validation',
      'tests',
      'documentation',
      'examples',
    ]) {
      assert.equal(paths.has(field), true, `expected issue for ${field}`);
    }
  }
});

test('requires deprecated tools to declare migration metadata', () => {
  const input = validManifest();
  input.status = 'deprecated';

  const result = validateToolManifest(input);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.issues.map((issue) => issue.message).join('\n'), /Deprecated tools require/u);
  }
});
