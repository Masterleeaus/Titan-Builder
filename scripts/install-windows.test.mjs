import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('./install-windows.ps1', import.meta.url), 'utf8');

test('installer resolves the repository root from its own script location', () => {
  assert.match(script, /\$RepositoryRoot\s*=.*\$PSScriptRoot/iu);
  assert.match(script, /Resolve-Path/iu);
  assert.match(script, /Push-Location\s+\$RepositoryRoot/iu);
  assert.match(script, /Pop-Location/iu);
  assert.doesNotMatch(script, /Join-Path\s+\(Get-Location\)\s+'browser-extension'/iu);
});

test('installer verifies Python and the browser-extension companion', () => {
  assert.match(script, /Require-Command\s+'python'/iu);
  assert.match(script, /Join-Path\s+\$RepositoryRoot\s+'browser-extension'/iu);
  assert.match(script, /Push-Location\s+\$CompanionRoot/iu);
  assert.match(script, /pnpm\s+install\s+--frozen-lockfile/iu);
  assert.match(script, /pnpm\s+run\s+verify/iu);
});

test('installer links the CLI, runs the doctor, and prints the canonical extension path', () => {
  assert.match(script, /pnpm\s+link\s+--global/iu);
  assert.match(script, /Require-Command\s+'openbrowser'/iu);
  assert.match(script, /openbrowser\s+doctor/iu);
  assert.match(script, /Load unpacked:\s+\$CompanionRoot/iu);
});

test('token generation remains compatible with Windows PowerShell 5.1', () => {
  assert.match(script, /RandomNumberGenerator\]::Create\(\)/iu);
  assert.match(script, /\.GetBytes\(\$tokenBytes\)/iu);
  assert.match(script, /\.GetBytes\(\$browserTokenBytes\)/iu);
  assert.doesNotMatch(script, /RandomNumberGenerator\]::Fill/iu);
});

test('background startup remains explicit and opt in', () => {
  assert.match(script, /param\([\s\S]*\[switch\]\$EnableBackgroundService[\s\S]*\)/iu);
  assert.match(script, /if\s*\(\$EnableBackgroundService\)\s*\{/iu);
  assert.match(script, /Register-ScheduledTask/iu);
  assert.match(script, /Background startup was not enabled/iu);
});
