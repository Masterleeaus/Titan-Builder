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
  assert.match(script, /Resolve-Python/iu);
  assert.match(script, /\$pythonExecutable\s*=\s*Resolve-Python/iu);
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

test('Python resolution validates 3.12+ requirement', () => {
  assert.match(script, /function\s+Resolve-Python/iu);
  assert.match(script, /MinMajor\s*=\s*3/iu);
  assert.match(script, /MinMinor\s*=\s*12/iu);
  assert.match(script, /\$major\s+-gt\s+\$MinMajor.*\$minor\s+-ge\s+\$MinMinor/iu);
});

test('Python resolution tries multiple candidates', () => {
  assert.match(script, /'python'/iu);
  assert.match(script, /'python3'/iu);
  assert.match(script, /'py\.exe'|'py'/iu);
  assert.match(script, /py\s+-3\s+--version/iu);
});

test('Python resolution parses version output correctly', () => {
  assert.match(script, /\[regex\]::Match/iu);
  assert.match(script, /Python\\s\+\(\\d\+\)\\\.\(\\d\+\)/iu);
  assert.match(script, /versionMatch\.Groups\[1\]\.Value/iu);
  assert.match(script, /versionMatch\.Groups\[2\]\.Value/iu);
});

test('Python resolution returns the selected executable path', () => {
  assert.match(script, /return\s+\$pythonPath/iu);
  assert.match(script, /\$pythonExecutable\s*=\s*Resolve-Python/iu);
});
