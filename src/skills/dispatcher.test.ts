import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveApprovedSkillEntrypoint } from './dispatcher.ts';

const approvedEntrypoint = {
  modulePath: 'runtime/entrypoint.js',
  exportName: 'resolveProjectPath',
};

test('resolves only the exact approved package module and export', () => {
  const approved = resolveApprovedSkillEntrypoint(
    'titan.security.project-path-containment',
    approvedEntrypoint,
  );
  assert.equal(typeof approved.handler, 'function');

  assert.throws(
    () => resolveApprovedSkillEntrypoint('titan.security.project-path-containment', {
      ...approvedEntrypoint,
      modulePath: 'runtime/other.js',
    }),
    /closed runtime dispatcher|not registered/i,
  );
  assert.throws(
    () => resolveApprovedSkillEntrypoint('titan.security.project-path-containment', {
      ...approvedEntrypoint,
      exportName: 'otherExport',
    }),
    /closed runtime dispatcher|not registered/i,
  );
});

test('rejects unknown executable skill identities', () => {
  assert.throws(
    () => resolveApprovedSkillEntrypoint('titan.untrusted.dynamic-code', {
      modulePath: 'runtime/entrypoint.js',
      exportName: 'run',
    }),
    /closed runtime dispatcher|not registered/i,
  );
});

test('approved handler validates input and returns the declared output envelope', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'titan-skill-dispatch-'));
  try {
    await mkdir(path.join(projectRoot, 'src'));
    const approved = resolveApprovedSkillEntrypoint(
      'titan.security.project-path-containment',
      approvedEntrypoint,
    );
    await assert.rejects(
      () => approved.handler({ requestedPath: 'src' }),
      /projectRoot.*requestedPath/i,
    );
    assert.deepEqual(await approved.handler({ projectRoot, requestedPath: 'src' }), {
      resolvedPath: path.join(await realpath(projectRoot), 'src'),
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
