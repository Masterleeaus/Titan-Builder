import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalizeProjectRoot,
  resolveProjectPath,
} from './project-path.ts';

async function fixture(): Promise<{ base: string; project: string; canonicalProject: string; outside: string }> {
  const base = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-path-security-'));
  const project = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await mkdir(project, { recursive: true });
  await mkdir(outside, { recursive: true });
  return { base, project, canonicalProject: await realpath(project), outside };
}

test('canonicalizes the authorized project root', async () => {
  const { project, canonicalProject } = await fixture();
  assert.equal(await canonicalizeProjectRoot(path.join(project, '.')), canonicalProject);
});

test('allows a new nested target when every existing ancestor is inside the project', async () => {
  const { project, canonicalProject } = await fixture();
  const resolved = await resolveProjectPath(project, 'src/new/deep/file.ts');
  assert.equal(resolved, path.join(canonicalProject, 'src/new/deep/file.ts'));
});

test('rejects lexical traversal and sibling-prefix confusion', async () => {
  const { project } = await fixture();
  await assert.rejects(() => resolveProjectPath(project, '../outside/file.txt'), /escapes project root/i);
  await assert.rejects(() => resolveProjectPath(project, `${project}-evil/file.txt`), /escapes project root/i);
});

test('rejects a new target beneath an intermediate symlink to outside', async () => {
  const { project, outside } = await fixture();
  await symlink(outside, path.join(project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => resolveProjectPath(project, 'link/escaped.txt'), /symbolic link|junction|escapes project root/i);
});

test('rejects an existing file reached through an intermediate symlink', async () => {
  const { project, outside } = await fixture();
  await writeFile(path.join(outside, 'secret.txt'), 'outside');
  await symlink(outside, path.join(project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => resolveProjectPath(project, 'link/secret.txt', { requireExisting: true }), /symbolic link|junction|escapes project root/i);
});

test('rejects a terminal symlink even when it points back inside the project', async () => {
  const { project } = await fixture();
  await writeFile(path.join(project, 'real.txt'), 'inside');
  await symlink(path.join(project, 'real.txt'), path.join(project, 'alias.txt'), 'file');
  await assert.rejects(() => resolveProjectPath(project, 'alias.txt', { requireExisting: true }), /symbolic link|junction/i);
});

test('requires an existing directory for tool working directories', async () => {
  const { project, canonicalProject } = await fixture();
  await mkdir(path.join(project, 'tools'), { recursive: true });
  assert.equal(
    await resolveProjectPath(project, 'tools', { requireExisting: true, expectedType: 'directory' }),
    path.join(canonicalProject, 'tools'),
  );
  await writeFile(path.join(project, 'not-a-directory'), 'x');
  await assert.rejects(
    () => resolveProjectPath(project, 'not-a-directory', { requireExisting: true, expectedType: 'directory' }),
    /directory/i,
  );
});

test('rejects version-control administrative namespaces', async () => {
  const { project } = await fixture();
  const paths = [
    '.git/config',
    'nested/.git/hooks/pre-commit',
    '.hg/store/data',
    '.svn/wc.db',
    '_darcs/hashed_inventory',
    '.bzr/branch/format',
    '.fslckout',
    '.fossil-settings/ignore-glob',
    '.jj/repo/store',
    'CVS/Root',
  ];

  for (const target of paths) {
    await assert.rejects(
      () => resolveProjectPath(project, target),
      /version-control metadata|reserved/i,
      target,
    );
  }
});

test('rejects case, separator, Unicode, and trailing-dot aliases for VCS metadata', async () => {
  const { project } = await fixture();
  const aliases = [
    '.GIT/config',
    'nested\\.git\\config',
    '.git./config',
    '.git /config',
    '．git/config',
    'nested／.git／hooks／pre-commit',
  ];

  for (const target of aliases) {
    await assert.rejects(
      () => resolveProjectPath(project, target),
      /version-control metadata|reserved/i,
      target,
    );
  }
});

test('does not reject ordinary source paths that merely mention VCS names', async () => {
  const { project, canonicalProject } = await fixture();
  const targets = ['src/git/client.ts', 'docs/.github/workflows.md', 'src/cvs-parser.ts'];

  for (const target of targets) {
    assert.equal(await resolveProjectPath(project, target), path.join(canonicalProject, target));
  }
});
