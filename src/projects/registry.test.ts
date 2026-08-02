import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getActiveProject,
  listProjects,
  registerProject,
  removeProject,
  setActiveProject,
} from './registry.ts';

async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openbrowser-projects-'));
  const homeDir = path.join(root, 'home');
  const projectRoot = path.join(root, 'sample-project');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"Sample App"}\n');
  return { homeDir, projectRoot, canonicalProjectRoot: await realpath(projectRoot) };
}

test('registers and deduplicates projects by canonical root', async () => {
  const { homeDir, projectRoot, canonicalProjectRoot } = await fixture();
  const first = await registerProject(projectRoot, { homeDir });
  const second = await registerProject(path.join(projectRoot, '.'), { homeDir, name: 'Renamed' });
  const projects = await listProjects({ homeDir });

  assert.equal(projects.length, 1);
  assert.equal(first.id, second.id);
  assert.equal(projects[0]?.name, 'Renamed');
  assert.equal(projects[0]?.root, canonicalProjectRoot);
});

test('persists and resolves an active project', async () => {
  const { homeDir, projectRoot, canonicalProjectRoot } = await fixture();
  const project = await registerProject(projectRoot, { homeDir });

  await setActiveProject(project.id, { homeDir });
  const active = await getActiveProject({ homeDir });

  assert.equal(active?.id, project.id);
  assert.equal(active?.root, canonicalProjectRoot);
});

test('removing the active project clears active state', async () => {
  const { homeDir, projectRoot } = await fixture();
  const project = await registerProject(projectRoot, { homeDir });
  await setActiveProject(project.id, { homeDir });

  await removeProject(project.id, { homeDir });

  assert.equal((await listProjects({ homeDir })).length, 0);
  assert.equal(await getActiveProject({ homeDir }), null);
});
