import { stdout } from 'node:process';
import type { Command } from 'commander';
import {
  runInstallDoctor,
  type InstallDoctorReport,
} from './install-doctor.js';

export interface DoctorCommandOptions {
  json?: boolean;
}

export interface DoctorCliDependencies {
  runDoctor?: typeof runInstallDoctor;
  write?: (text: string) => void;
  setExitCode?: (code: number) => void;
}

export function registerDoctorCommand(
  program: Command,
  dependencies: DoctorCliDependencies = {},
): void {
  program
    .command('doctor')
    .description('Check local OpenBrowser installation and Chrome workflow readiness')
    .option('--json', 'emit a machine-readable JSON report')
    .action(async (options: DoctorCommandOptions) => {
      await executeDoctorCommand(options, dependencies);
    });
}

export async function executeDoctorCommand(
  options: DoctorCommandOptions = {},
  dependencies: DoctorCliDependencies = {},
): Promise<InstallDoctorReport> {
  const report = await (dependencies.runDoctor ?? runInstallDoctor)();
  const write = dependencies.write ?? ((text: string) => stdout.write(text));
  const setExitCode = dependencies.setExitCode ?? ((code: number) => {
    process.exitCode = code;
  });

  write(options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${formatDoctorReport(report)}\n`);
  setExitCode(report.ok ? 0 : 1);
  return report;
}

export function formatDoctorReport(report: InstallDoctorReport): string {
  const lines = [
    'OpenBrowser installation doctor',
    `Generated: ${report.generatedAt}`,
    '',
  ];

  for (const check of report.checks) {
    lines.push(`${check.status.toUpperCase().padEnd(4)}  ${check.id} — ${check.summary}`);
    if (check.detail) lines.push(`      ${check.detail}`);
    if (check.remediation) lines.push(`      Fix: ${check.remediation}`);
  }

  const passed = report.checks.filter((check) => check.status === 'pass').length;
  const warnings = report.checks.filter((check) => check.status === 'warn').length;
  const failed = report.checks.filter((check) => check.status === 'fail').length;
  lines.push('');
  lines.push(
    `${plural(report.checks.length, 'check')}: ${passed} passed, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}, ${failed} failed`,
  );
  lines.push(report.ok
    ? 'Result: ready, with any warnings shown above.'
    : 'Result: blocked until all failed checks are resolved.');
  return lines.join('\n');
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
