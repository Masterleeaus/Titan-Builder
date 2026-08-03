import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  SkillDispatchError,
  createExecutableSkillDispatcher,
} from './dispatcher.js';
import { createExecutableSkillHandlerRegistry } from './handlers.js';
import type { LoadedSkillPackage } from './loader.js';
import type { TitanSkillManifest } from './manifest.js';
import { createSkillRegistry, loadSkillRegistry } from './registry.js';

const libraryRoot = path.resolve('browser-extension/skill-library/packages');

function manifest(overrides: Partial<TitanSkillManifest> = {}): TitanSkillManifest {
  return {
    schemaVersion: '1',
    id: 'titan.testing.synthetic-executable',
    name: 'Synthetic Executable',
    version: '1.0.0',
    status: 'stable',
    kind: 'executable',
    category: 'testing',
    description: 'Synthetic executable skill for dispatcher tests.',
    owner: 'Titan Builder',
    runtimeTargets: ['root'],
    entrypoint: 'src/testing/synthetic.ts#executeSynthetic',
    inputs: {
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: { value: { type: 'string' } },
    },
    outputs: {
      type: 'object',
      additionalProperties: false,
      required: ['result'],
      properties: { result: { type: 'string' } },
    },
    dependencies: [],
    capabilities: [],
    risk: 'READ',
    approval: 'none',
    tags: ['testing'],
    aliases: ['synthetic'],
    ...overrides,
  };
}

function loaded(manifestValue: TitanSkillManifest): LoadedSkillPackage {
  return {
    manifest: manifestValue,
    packageRoot: '/virtual/skill',
    manifestPath: '/virtual/skill/manifest.json',
  };
}

function expectDispatchCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof SkillDispatchError && error.code === code;
}

test('dispatches the canonical project-path skill through its static handler', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'titan-skill-dispatch-'));
  await mkdir(path.join(projectRoot, 'docs'));
  await writeFile(path.join(projectRoot, 'docs', 'note.txt'), 'hello\n');
  const registry = await loadSkillRegistry(libraryRoot);
  const dispatcher = createExecutableSkillDispatcher({ registry });

  const result = await dispatcher.dispatch({
    skillId: 'titan.security.project-path-containment',
    input: { projectRoot, requestedPath: 'docs/note.txt' },
    runtimeTarget: 'root',
    grantedCapabilities: ['filesystem.read'],
  });

  assert.equal(result.skillId, 'titan.security.project-path-containment');
  assert.deepEqual(result.output, {
    resolvedPath: await import('node:fs/promises').then(({ realpath }) => realpath(path.join(projectRoot, 'docs', 'note.txt'))),
  });
});

test('resolves an executable alias to its canonical skill id', async () => {
  const registry = createSkillRegistry([loaded(manifest())]);
  const handlers = createExecutableSkillHandlerRegistry({
    'src/testing/synthetic.ts#executeSynthetic': ({ value }: { value: string }) => ({ result: value.toUpperCase() }),
  });
  const dispatcher = createExecutableSkillDispatcher({ registry, handlers });

  const result = await dispatcher.dispatch({
    skillId: 'synthetic',
    input: { value: 'titan' },
    runtimeTarget: 'root',
    grantedCapabilities: [],
  });

  assert.equal(result.skillId, 'titan.testing.synthetic-executable');
  assert.deepEqual(result.output, { result: 'TITAN' });
});

test('rejects a missing capability grant before invoking the handler', async () => {
  let invoked = false;
  const skill = manifest({ capabilities: ['filesystem.read'] });
  const dispatcher = createExecutableSkillDispatcher({
    registry: createSkillRegistry([loaded(skill)]),
    handlers: createExecutableSkillHandlerRegistry({
      [skill.entrypoint!]: () => {
        invoked = true;
        return { result: 'should-not-run' };
      },
    }),
  });

  await assert.rejects(
    () => dispatcher.dispatch({
      skillId: skill.id,
      input: { value: 'x' },
      runtimeTarget: 'root',
      grantedCapabilities: [],
    }),
    expectDispatchCode('CAPABILITY_NOT_GRANTED'),
  );
  assert.equal(invoked, false);
});

test('rejects a runtime target not declared by the manifest', async () => {
  const skill = manifest();
  const dispatcher = createExecutableSkillDispatcher({
    registry: createSkillRegistry([loaded(skill)]),
    handlers: createExecutableSkillHandlerRegistry({ [skill.entrypoint!]: () => ({ result: 'x' }) }),
  });

  await assert.rejects(
    () => dispatcher.dispatch({
      skillId: skill.id,
      input: { value: 'x' },
      runtimeTarget: 'cli',
      grantedCapabilities: [],
    }),
    expectDispatchCode('RUNTIME_NOT_ALLOWED'),
  );
});

test('rejects guidance skills from executable dispatch', async () => {
  const skill = manifest({
    id: 'titan.guidance.synthetic',
    kind: 'guidance',
    entrypoint: undefined,
    instructions: 'instructions.md',
  });
  const dispatcher = createExecutableSkillDispatcher({
    registry: createSkillRegistry([loaded(skill)]),
  });

  await assert.rejects(
    () => dispatcher.dispatch({
      skillId: skill.id,
      input: {},
      runtimeTarget: 'root',
      grantedCapabilities: [],
    }),
    expectDispatchCode('SKILL_NOT_EXECUTABLE'),
  );
});

test('enforces explicit and policy approval modes before handler invocation', async () => {
  for (const [approval, requestFlag] of [
    ['explicit', 'approvalGranted'],
    ['policy', 'policyApprovalGranted'],
  ] as const) {
    let invoked = false;
    const skill = manifest({ approval });
    const dispatcher = createExecutableSkillDispatcher({
      registry: createSkillRegistry([loaded(skill)]),
      handlers: createExecutableSkillHandlerRegistry({
        [skill.entrypoint!]: () => {
          invoked = true;
          return { result: 'ok' };
        },
      }),
    });

    await assert.rejects(
      () => dispatcher.dispatch({
        skillId: skill.id,
        input: { value: 'x' },
        runtimeTarget: 'root',
        grantedCapabilities: [],
      }),
      expectDispatchCode('APPROVAL_REQUIRED'),
    );
    assert.equal(invoked, false);

    const result = await dispatcher.dispatch({
      skillId: skill.id,
      input: { value: 'x' },
      runtimeTarget: 'root',
      grantedCapabilities: [],
      [requestFlag]: true,
    });
    assert.deepEqual(result.output, { result: 'ok' });
  }
});

test('fails closed when an executable entrypoint has no static handler', async () => {
  const skill = manifest();
  const dispatcher = createExecutableSkillDispatcher({
    registry: createSkillRegistry([loaded(skill)]),
    handlers: createExecutableSkillHandlerRegistry({}),
  });

  await assert.rejects(
    () => dispatcher.dispatch({
      skillId: skill.id,
      input: { value: 'x' },
      runtimeTarget: 'root',
      grantedCapabilities: [],
    }),
    expectDispatchCode('HANDLER_NOT_REGISTERED'),
  );
});

test('rejects invalid manifest input before invoking the handler', async () => {
  let invoked = false;
  const skill = manifest();
  const dispatcher = createExecutableSkillDispatcher({
    registry: createSkillRegistry([loaded(skill)]),
    handlers: createExecutableSkillHandlerRegistry({
      [skill.entrypoint!]: () => {
        invoked = true;
        return { result: 'x' };
      },
    }),
  });

  await assert.rejects(
    () => dispatcher.dispatch({
      skillId: skill.id,
      input: { value: 42 },
      runtimeTarget: 'root',
      grantedCapabilities: [],
    }),
    expectDispatchCode('INVALID_INPUT'),
  );
  assert.equal(invoked, false);
});

test('rejects handler output that violates the manifest output schema', async () => {
  const skill = manifest();
  const dispatcher = createExecutableSkillDispatcher({
    registry: createSkillRegistry([loaded(skill)]),
    handlers: createExecutableSkillHandlerRegistry({
      [skill.entrypoint!]: () => ({ result: 42 }),
    }),
  });

  await assert.rejects(
    () => dispatcher.dispatch({
      skillId: skill.id,
      input: { value: 'x' },
      runtimeTarget: 'root',
      grantedCapabilities: [],
    }),
    expectDispatchCode('INVALID_OUTPUT'),
  );
});

test('preserves authoritative project-path traversal rejection', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'titan-skill-dispatch-'));
  const registry = await loadSkillRegistry(libraryRoot);
  const dispatcher = createExecutableSkillDispatcher({ registry });

  await assert.rejects(
    () => dispatcher.dispatch({
      skillId: 'titan.security.project-path-containment',
      input: { projectRoot, requestedPath: '../outside.txt' },
      runtimeTarget: 'root',
      grantedCapabilities: ['filesystem.read'],
    }),
    /escapes project root/i,
  );
});
