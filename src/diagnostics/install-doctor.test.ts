import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInstallDoctor } from './install-doctor.ts';

async function fixture(): Promise<{ homeDir: string; packageRoot: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-doctor-'));
  const homeDir = path.join(root, 'home');
  const packageRoot = path.join(root, 'package');
  await mkdir(path.join(homeDir, '.openbrowser'), { recursive: true });
  await mkdir(path.join(packageRoot, 'browser-extension'), { recursive: true });
  await writeFile(
    path.join(packageRoot, 'browser-extension', 'manifest.json'),
    JSON.stringify({ manifest_version: 3, name: 'OpenBrowser', version: '0.5.0' }),
    'utf8',
  );
  await writeFile(
    path.join(packageRoot, 'browser-extension', 'package.json'),
    JSON.stringify({ name: '@titan-builder/openbrowser-workspace' }),
    'utf8',
  );
  return { homeDir, packageRoot };
}

const CONTROL_TOKEN = 'control-token-abcdefghijklmnopqrstuvwxyz-123456';
const BROWSER_TOKEN = 'browser-token-abcdefghijklmnopqrstuvwxyz-654321';

test('installation doctor returns stable passing checks without exposing credentials', async () => {
  const { homeDir, packageRoot } = await fixture();
  await writeFile(
    path.join(homeDir, '.openbrowser', '.env'),
    [
      `BRIDGE_TOKEN=${CONTROL_TOKEN}`,
      `BRIDGE_BROWSER_TOKEN=${BROWSER_TOKEN}`,
      'OPENBROWSER_INSECURE_DEV=0',
      'OPENBROWSER_ALLOW_UNSAFE_COMMANDS=0',
    ].join('\n'),
    'utf8',
  );

  const report = await runInstallDoctor({
    homeDir,
    packageRoot,
    nodeVersion: '22.14.0',
    serviceStatus: async () => ({
      status: 'running',
      pid: 4321,
      startedAt: '2026-08-02T00:00:00.000Z',
      logPath: path.join(homeDir, '.openbrowser', 'logs', 'service.log'),
      healthy: true,
    }),
    projects: async () => [{
      id: 'project-0123456789abcdef',
      name: 'Fixture',
      root: packageRoot,
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    }],
    now: () => new Date('2026-08-02T04:00:00.000Z'),
  });

  assert.equal(report.ok, true);
  assert.equal(report.generatedAt, '2026-08-02T04:00:00.000Z');
  assert.deepEqual(
    report.checks.map((check) => check.id),
    [
      'runtime.node',
      'config.file',
      'config.control-token',
      'config.browser-token',
      'config.token-separation',
      'config.secure-mode',
      'extension.manifest',
      'companion.package',
      'projects.registry',
      'service.bridge',
    ],
  );
  assert.ok(report.checks.every((check) => check.status === 'pass'));

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(CONTROL_TOKEN), false);
  assert.equal(serialized.includes(BROWSER_TOKEN), false);
});

test('missing projects and a stopped service are warnings rather than failures', async () => {
  const { homeDir, packageRoot } = await fixture();
  await writeFile(
    path.join(homeDir, '.openbrowser', '.env'),
    [
      `BRIDGE_TOKEN=${CONTROL_TOKEN}`,
      `BRIDGE_BROWSER_TOKEN=${BROWSER_TOKEN}`,
      'OPENBROWSER_INSECURE_DEV=0',
      'OPENBROWSER_ALLOW_UNSAFE_COMMANDS=0',
    ].join('\n'),
    'utf8',
  );

  const report = await runInstallDoctor({
    homeDir,
    packageRoot,
    nodeVersion: '22.0.0',
    serviceStatus: async () => ({
      status: 'stopped',
      logPath: path.join(homeDir, '.openbrowser', 'logs', 'service.log'),
    }),
    projects: async () => [],
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.find((check) => check.id === 'projects.registry')?.status, 'warn');
  assert.equal(report.checks.find((check) => check.id === 'service.bridge')?.status, 'warn');
});

test('invalid runtime and credentials produce blocking failures', async () => {
  const { homeDir, packageRoot } = await fixture();
  await writeFile(
    path.join(homeDir, '.openbrowser', '.env'),
    [
      'BRIDGE_TOKEN=same-short-token',
      'BRIDGE_BROWSER_TOKEN=same-short-token',
      'OPENBROWSER_INSECURE_DEV=1',
      'OPENBROWSER_ALLOW_UNSAFE_COMMANDS=1',
    ].join('\n'),
    'utf8',
  );

  const report = await runInstallDoctor({
    homeDir,
    packageRoot,
    nodeVersion: '20.18.0',
    serviceStatus: async () => ({
      status: 'running',
      pid: 111,
      startedAt: '2026-08-02T00:00:00.000Z',
      logPath: path.join(homeDir, '.openbrowser', 'logs', 'service.log'),
      healthy: false,
    }),
    projects: async () => [],
  });

  assert.equal(report.ok, false);
  for (const id of [
    'runtime.node',
    'config.control-token',
    'config.browser-token',
    'config.token-separation',
    'config.secure-mode',
    'service.bridge',
  ]) {
    assert.equal(report.checks.find((check) => check.id === id)?.status, 'fail', id);
  }
});

test('missing configuration is reported as a blocking failure without throwing', async () => {
  const { homeDir, packageRoot } = await fixture();
  const report = await runInstallDoctor({
    homeDir,
    packageRoot,
    nodeVersion: '22.0.0',
    serviceStatus: async () => ({ status: 'stopped', logPath: 'service.log' }),
    projects: async () => [],
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.find((check) => check.id === 'config.file')?.status, 'fail');
  assert.equal(report.checks.find((check) => check.id === 'config.control-token')?.status, 'fail');
  assert.equal(report.checks.find((check) => check.id === 'config.browser-token')?.status, 'fail');
});
