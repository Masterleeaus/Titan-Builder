import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import fs from 'fs-extra';
import {
  resolveProjectForOperation,
  resolveProjectExplicit,
  assertProjectRootAuthority,
  type ResolvedProject,
} from './resolver.ts';
import {
  registerProject,
  setActiveProject,
  removeProject,
  type ProjectRegistryOptions,
} from './registry.ts';

const testDir = '/tmp/project-resolver-test';

async function setupTestRegistry(): Promise<ProjectRegistryOptions> {
  await fs.ensureDir(testDir);
  const homeDir = path.join(testDir, 'home');
  await fs.ensureDir(homeDir);
  return { homeDir };
}

async function cleanupTestRegistry(): Promise<void> {
  await fs.remove(testDir);
}

test('project resolver', async (t) => {
  await t.test('resolves active project when set', async () => {
    const options = await setupTestRegistry();
    try {
      const projectDir = path.join(testDir, 'project1');
      await fs.ensureDir(projectDir);

      const registered = await registerProject(projectDir, options);
      await setActiveProject(registered.id, options);

      const resolved = await resolveProjectForOperation(options);

      assert.equal(resolved.id, registered.id);
      assert.equal(resolved.root, registered.root);
      assert.equal(resolved.isActive, true);
      assert.equal(resolved.source, 'active');
    } finally {
      await cleanupTestRegistry();
    }
  });

  await t.test('falls back to current directory when no active project', async () => {
    const options = await setupTestRegistry();
    const originalCwd = process.cwd();
    try {
      const projectDir = path.join(testDir, 'project2');
      await fs.ensureDir(projectDir);
      process.chdir(projectDir);

      const resolved = await resolveProjectForOperation(options);

      assert.equal(resolved.root, projectDir);
      assert.equal(resolved.isActive, false);
      assert.equal(resolved.source, 'current');
    } finally {
      process.chdir(originalCwd);
      await cleanupTestRegistry();
    }
  });

  await t.test('throws when no active project and fallback disabled', async () => {
    const options = await setupTestRegistry();
    try {
      await assert.rejects(
        async () => await resolveProjectForOperation({ ...options, fallbackToCurrentDir: false }),
        /No active project/,
      );
    } finally {
      await cleanupTestRegistry();
    }
  });

  await t.test('resolves explicit project by registered ID', async () => {
    const options = await setupTestRegistry();
    try {
      const projectDir = path.join(testDir, 'project3');
      await fs.ensureDir(projectDir);

      const registered = await registerProject(projectDir, options);
      const resolved = await resolveProjectExplicit(registered.id, options);

      assert.equal(resolved.id, registered.id);
      assert.equal(resolved.source, 'registered');
    } finally {
      await cleanupTestRegistry();
    }
  });

  await t.test('resolves explicit project by filesystem path', async () => {
    const options = await setupTestRegistry();
    try {
      const projectDir = path.join(testDir, 'project4');
      await fs.ensureDir(projectDir);

      const resolved = await resolveProjectExplicit(projectDir, options);

      assert.equal(resolved.root, projectDir);
      assert.equal(resolved.source, 'explicit');
    } finally {
      await cleanupTestRegistry();
    }
  });

  await t.test('detects mismatch between declared and active project', async () => {
    const options = await setupTestRegistry();
    try {
      const project1Dir = path.join(testDir, 'mismatch1');
      const project2Dir = path.join(testDir, 'mismatch2');
      await fs.ensureDir(project1Dir);
      await fs.ensureDir(project2Dir);

      const proj1 = await registerProject(project1Dir, options);
      await registerProject(project2Dir, options);
      await setActiveProject(proj1.id, options);

      await assert.rejects(
        async () => await assertProjectRootAuthority(project2Dir, options),
        /Project root mismatch/,
      );
    } finally {
      await cleanupTestRegistry();
    }
  });

  await t.test('allows matching declared and active project', async () => {
    const options = await setupTestRegistry();
    try {
      const projectDir = path.join(testDir, 'match');
      await fs.ensureDir(projectDir);

      const registered = await registerProject(projectDir, options);
      await setActiveProject(registered.id, options);

      const resolved = await assertProjectRootAuthority(projectDir, options);

      assert.equal(resolved.id, registered.id);
      assert.equal(resolved.isActive, true);
    } finally {
      await cleanupTestRegistry();
    }
  });

  await t.test('marks active project in resolved result', async () => {
    const options = await setupTestRegistry();
    try {
      const project1Dir = path.join(testDir, 'active-check1');
      const project2Dir = path.join(testDir, 'active-check2');
      await fs.ensureDir(project1Dir);
      await fs.ensureDir(project2Dir);

      const proj1 = await registerProject(project1Dir, options);
      const proj2 = await registerProject(project2Dir, options);
      await setActiveProject(proj1.id, options);

      const resolved1 = await resolveProjectExplicit(proj1.id, options);
      const resolved2 = await resolveProjectExplicit(proj2.id, options);

      assert.equal(resolved1.isActive, true);
      assert.equal(resolved2.isActive, false);
    } finally {
      await cleanupTestRegistry();
    }
  });

  await t.test('handles project name resolution', async () => {
    const options = await setupTestRegistry();
    try {
      const projectDir = path.join(testDir, 'named-project');
      await fs.ensureDir(projectDir);

      const registered = await registerProject(projectDir, { ...options, name: 'My Project' });
      await setActiveProject(registered.id, options);

      const resolved = await resolveProjectForOperation(options);

      assert.equal(resolved.name, 'My Project');
    } finally {
      await cleanupTestRegistry();
    }
  });

  await t.test('maintains source tracking across resolution', async () => {
    const options = await setupTestRegistry();
    const originalCwd = process.cwd();
    try {
      const projectDir = path.join(testDir, 'source-track');
      await fs.ensureDir(projectDir);
      process.chdir(projectDir);

      const resolved = await resolveProjectForOperation(options);

      assert.equal(resolved.source, 'current');
      assert.equal(resolved.isActive, false);
    } finally {
      process.chdir(originalCwd);
      await cleanupTestRegistry();
    }
  });

  await t.test('rejects empty project identifier', async () => {
    const options = await setupTestRegistry();
    try {
      await assert.rejects(
        async () => await resolveProjectExplicit('', options),
        /Project identifier.*required/,
      );

      await assert.rejects(
        async () => await resolveProjectExplicit('   ', options),
        /Project identifier.*required/,
      );
    } finally {
      await cleanupTestRegistry();
    }
  });
});
