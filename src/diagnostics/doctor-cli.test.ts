import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeDoctorCommand,
  formatDoctorReport,
} from './doctor-cli.ts';
import type { InstallDoctorReport } from './install-doctor.ts';

const warningReport: InstallDoctorReport = {
  ok: true,
  generatedAt: '2026-08-02T04:00:00.000Z',
  checks: [
    {
      id: 'runtime.node',
      status: 'pass',
      summary: 'Node.js is supported.',
    },
    {
      id: 'projects.registry',
      status: 'warn',
      summary: 'No projects are registered.',
      remediation: 'Run openbrowser project add .',
    },
  ],
};

const failingReport: InstallDoctorReport = {
  ok: false,
  generatedAt: '2026-08-02T04:00:00.000Z',
  checks: [
    {
      id: 'config.browser-token',
      status: 'fail',
      summary: 'Browser token is missing.',
      remediation: 'Run the installer.',
    },
  ],
};

test('human doctor output shows status summaries and remediation without secrets', () => {
  const output = formatDoctorReport(warningReport);
  assert.match(output, /OpenBrowser installation doctor/u);
  assert.match(output, /PASS\s+runtime\.node/u);
  assert.match(output, /WARN\s+projects\.registry/u);
  assert.match(output, /Run openbrowser project add \./u);
  assert.doesNotMatch(output, /BRIDGE_TOKEN|BRIDGE_BROWSER_TOKEN|abcdefghijklmnopqrstuvwxyz/u);
});

test('JSON doctor output emits the exact structured report and no decoration', async () => {
  const writes: string[] = [];
  const exitCodes: number[] = [];

  const result = await executeDoctorCommand(
    { json: true },
    {
      runDoctor: async () => warningReport,
      write: (text) => writes.push(text),
      setExitCode: (code) => exitCodes.push(code),
    },
  );

  assert.deepEqual(result, warningReport);
  assert.equal(writes.join(''), `${JSON.stringify(warningReport, null, 2)}\n`);
  assert.deepEqual(exitCodes, [0]);
});

test('warnings-only reports exit successfully', async () => {
  const writes: string[] = [];
  const exitCodes: number[] = [];

  await executeDoctorCommand(
    {},
    {
      runDoctor: async () => warningReport,
      write: (text) => writes.push(text),
      setExitCode: (code) => exitCodes.push(code),
    },
  );

  assert.deepEqual(exitCodes, [0]);
  assert.match(writes.join(''), /2 checks: 1 passed, 1 warning, 0 failed/u);
});

test('blocking failures set exit code one', async () => {
  const writes: string[] = [];
  const exitCodes: number[] = [];

  await executeDoctorCommand(
    {},
    {
      runDoctor: async () => failingReport,
      write: (text) => writes.push(text),
      setExitCode: (code) => exitCodes.push(code),
    },
  );

  assert.deepEqual(exitCodes, [1]);
  assert.match(writes.join(''), /FAIL\s+config\.browser-token/u);
  assert.match(writes.join(''), /1 check: 0 passed, 0 warnings, 1 failed/u);
});
