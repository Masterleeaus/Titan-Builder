import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readProjectStatus } from './status.ts';

test('reads branch and dirty state from a git project', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openbrowser-status-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'OpenBrowser Test'], { cwd: root });
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  execFileSync('git', ['add', 'package.json'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'initial'], { cwd: root });

  const clean = await readProjectStatus(root);
  assert.equal(clean.isGitRepository, true);
  assert.equal(clean.branch.length > 0, true);
  assert.equal(clean.dirty, false);
  assert.equal(clean.changedFiles, 0);
  assert.equal(clean.packageManager, 'npm');

  writeFileSync(path.join(root, 'README.md'), '# changed\n');
  const dirty = await readProjectStatus(root);
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.changedFiles, 1);
});
