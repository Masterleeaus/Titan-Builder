import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createBridgeServer } from './index.ts';

const execFileAsync = promisify(execFile);
const CONTROL_TOKEN = 'control-'.padEnd(56, 'a');
const BROWSER_TOKEN = 'browser-'.padEnd(56, 'b');
const controlHeaders = { authorization: `Bearer ${CONTROL_TOKEN}` };

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

async function createProject(branch: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-server-protected-'));
  await runGit(projectRoot, ['init', '-b', branch]);
  await runGit(projectRoot, ['config', 'user.name', 'Titan Test']);
  await runGit(projectRoot, ['config', 'user.email', 'titan@example.invalid']);
  await writeFile(path.join(projectRoot, 'tracked.txt'), 'tracked\n', 'utf8');
  await runGit(projectRoot, ['add', 'tracked.txt']);
  await runGit(projectRoot, ['commit', '-m', 'initial']);
  return projectRoot;
}

async function previewStatus(
  projectRoot: string,
  protectedBranches?: string[],
): Promise<{ statusCode: number; payload: Record<string, unknown> }> {
  const app = await createBridgeServer({
    projectRoot,
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
    protectedBranches,
  });
  await app.ready();
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/operations/preview',
      headers: controlHeaders,
      payload: {
        operations: [
          { action: 'CREATE_FILE', path: 'approved.txt', content: 'approved\n' },
        ],
      },
    });
    return {
      statusCode: response.statusCode,
      payload: response.json() as Record<string, unknown>,
    };
  } finally {
    await app.close();
  }
}

test('bridge preview rejects configured protected branches before issuing a bearer capability', async () => {
  const projectRoot = await createProject('main');
  try {
    const result = await previewStatus(projectRoot, ['main', 'master']);
    assert.equal(result.statusCode, 403);
    assert.match(String(result.payload.error), /protected branch.*main/i);
    assert.equal('approval' in result.payload, false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('bridge preview allows feature branches and remains backward compatible without policy', async () => {
  for (const [branch, protectedBranches] of [
    ['feature/review', ['main']],
    ['main', undefined],
  ] as const) {
    const projectRoot = await createProject(branch);
    try {
      const result = await previewStatus(
        projectRoot,
        protectedBranches ? [...protectedBranches] : undefined,
      );
      assert.equal(result.statusCode, 200);
      assert.equal(typeof (result.payload.approval as { token?: unknown } | undefined)?.token, 'string');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }
});
