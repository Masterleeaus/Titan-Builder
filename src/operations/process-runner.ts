import { execFile, spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';

export type ProcessFailureKind =
  | 'spawn'
  | 'exit'
  | 'timeout'
  | 'output_limit'
  | 'termination';

export interface ProcessTerminationReport {
  platform: NodeJS.Platform;
  requested: 'graceful';
  forced: boolean;
  confirmed: boolean;
  graceMs: number;
  residualPids: number[];
}

export interface ContainedProcessFailure {
  kind: ProcessFailureKind;
  toolId: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  timeoutMs?: number;
  maxOutputBytes?: number;
  termination?: ProcessTerminationReport;
}

export class ContainedProcessError extends Error {
  readonly details: ContainedProcessFailure;

  constructor(message: string, details: ContainedProcessFailure, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ContainedProcessError';
    this.details = details;
  }
}

export interface RunContainedProcessOptions {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  toolId?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  terminationGraceMs?: number;
}

export interface RunContainedProcessResult {
  stdout: string;
  stderr: string;
  code: number;
  signal: NodeJS.Signals | null;
}

interface ProcessRow {
  pid: number;
  parentPid: number;
  groupPid?: number;
  state?: string;
}

const DEFAULT_TERMINATION_GRACE_MS = 1_000;
const PROCESS_POLL_MS = 25;
const PROCESS_LIST_TIMEOUT_MS = 5_000;
const PROCESS_LIST_MAX_BYTES = 4 * 1024 * 1024;

export async function runContainedProcess(
  options: RunContainedProcessOptions,
): Promise<RunContainedProcessResult> {
  assertPositiveInteger(options.timeoutMs, 'timeoutMs');
  assertPositiveInteger(options.maxOutputBytes, 'maxOutputBytes');
  const graceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  assertPositiveInteger(graceMs, 'terminationGraceMs');
  const toolId = options.toolId ?? options.executable;

  let child: ChildProcess;
  try {
    child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new ContainedProcessError(
      `Failed to start ${toolId}: ${formatUnknownError(error)}`,
      { kind: 'spawn', toolId },
      { cause: error },
    );
  }

  return new Promise<RunContainedProcessResult>((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let terminating = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (
      error?: Error,
      result?: RunContainedProcessResult,
    ): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.stdout?.removeAllListeners('data');
      child.stderr?.removeAllListeners('data');
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error(`${toolId} settled without a result`));
    };

    const requestTermination = (
      kind: 'timeout' | 'output_limit',
      message: string,
    ): void => {
      if (settled || terminating) return;
      terminating = true;
      if (timer) clearTimeout(timer);
      child.stdout?.pause();
      child.stderr?.pause();

      void terminateProcessTree(child, graceMs)
        .then((termination) => {
          const diagnostic = formatTermination(termination);
          settle(new ContainedProcessError(
            `${message}; ${diagnostic}`,
            {
              kind,
              toolId,
              timeoutMs: kind === 'timeout' ? options.timeoutMs : undefined,
              maxOutputBytes: kind === 'output_limit' ? options.maxOutputBytes : undefined,
              termination,
            },
          ));
        })
        .catch((error) => {
          settle(new ContainedProcessError(
            `${message}; process-tree termination failed: ${formatUnknownError(error)}`,
            {
              kind: 'termination',
              toolId,
            },
            { cause: error },
          ));
        });
    };

    const append = (target: Buffer[], chunk: Buffer | string): void => {
      if (settled || terminating) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        requestTermination(
          'output_limit',
          `${toolId} output exceeded ${options.maxOutputBytes} bytes`,
        );
        return;
      }
      target.push(buffer);
    };

    child.stdout?.on('data', (chunk: Buffer) => append(stdout, chunk));
    child.stderr?.on('data', (chunk: Buffer) => append(stderr, chunk));

    child.once('error', (error) => {
      if (terminating) return;
      settle(new ContainedProcessError(
        `Failed to start ${toolId}: ${error.message}`,
        { kind: 'spawn', toolId },
        { cause: error },
      ));
    });

    child.once('close', (code, signal) => {
      if (terminating || settled) return;
      const result: RunContainedProcessResult = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code: code ?? -1,
        signal,
      };
      if (code === 0) {
        settle(undefined, result);
        return;
      }
      settle(new ContainedProcessError(
        `${toolId} failed${code === null ? '' : ` with exit code ${code}`}${signal ? ` (${signal})` : ''}`,
        {
          kind: 'exit',
          toolId,
          code,
          signal,
        },
      ));
    });

    timer = setTimeout(() => {
      requestTermination(
        'timeout',
        `${toolId} timed out after ${options.timeoutMs}ms`,
      );
    }, options.timeoutMs);
  });
}

async function terminateProcessTree(
  child: ChildProcess,
  graceMs: number,
): Promise<ProcessTerminationReport> {
  const pid = child.pid;
  if (!pid) {
    return {
      platform: process.platform,
      requested: 'graceful',
      forced: false,
      confirmed: true,
      graceMs,
      residualPids: [],
    };
  }

  return process.platform === 'win32'
    ? terminateWindowsProcessTree(pid, graceMs)
    : terminatePosixProcessTree(pid, graceMs);
}

async function terminatePosixProcessTree(
  rootPid: number,
  graceMs: number,
): Promise<ProcessTerminationReport> {
  const knownPids = await collectPosixTreeMembers(rootPid);
  knownPids.add(rootPid);
  signalPosixGroup(rootPid, 'SIGTERM');
  for (const pid of knownPids) signalPid(pid, 'SIGTERM');

  let residualPids = await waitForPosixTreeExit(rootPid, knownPids, graceMs);
  let forced = false;
  if (residualPids.length > 0) {
    forced = true;
    signalPosixGroup(rootPid, 'SIGKILL');
    for (const pid of residualPids) signalPid(pid, 'SIGKILL');
    residualPids = await waitForPosixTreeExit(rootPid, knownPids, graceMs);
  }

  return {
    platform: process.platform,
    requested: 'graceful',
    forced,
    confirmed: residualPids.length === 0,
    graceMs,
    residualPids,
  };
}

async function collectPosixTreeMembers(rootPid: number): Promise<Set<number>> {
  const rows = await readPosixProcessRows();
  if (!rows) return new Set([rootPid]);
  return collectDescendants(rows, rootPid, true);
}

async function waitForPosixTreeExit(
  rootPid: number,
  knownPids: Set<number>,
  timeoutMs: number,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let residualPids: number[] = [];

  do {
    const rows = await readPosixProcessRows();
    if (!rows) {
      residualPids = [...knownPids].filter(isPidAlive);
    } else {
      const currentMembers = collectDescendants(rows, rootPid, true);
      for (const pid of currentMembers) knownPids.add(pid);
      const rowByPid = new Map(rows.map((row) => [row.pid, row]));
      residualPids = [...knownPids].filter((pid) => {
        const row = rowByPid.get(pid);
        return Boolean(row && !row.state?.includes('Z'));
      });
    }
    if (residualPids.length === 0) return [];
    await delay(PROCESS_POLL_MS);
  } while (Date.now() < deadline);

  return residualPids.sort((left, right) => left - right);
}

async function readPosixProcessRows(): Promise<ProcessRow[] | undefined> {
  try {
    const { stdout } = await execFileText('ps', ['-eo', 'pid=,ppid=,pgid=,stat=']);
    return stdout
      .split(/\r?\n/u)
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/u))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        groupPid: Number(match[3]),
        state: match[4],
      }));
  } catch {
    return undefined;
  }
}

async function terminateWindowsProcessTree(
  rootPid: number,
  graceMs: number,
): Promise<ProcessTerminationReport> {
  const knownPids = await collectWindowsTreeMembers(rootPid);
  knownPids.add(rootPid);
  await runTaskkill(rootPid, false);

  let residualPids = await waitForPidsExit(knownPids, graceMs);
  let forced = false;
  if (residualPids.length > 0) {
    forced = true;
    await Promise.all(residualPids.map((pid) => runTaskkill(pid, true)));
    residualPids = await waitForPidsExit(knownPids, graceMs);
  }

  return {
    platform: process.platform,
    requested: 'graceful',
    forced,
    confirmed: residualPids.length === 0,
    graceMs,
    residualPids,
  };
}

async function collectWindowsTreeMembers(rootPid: number): Promise<Set<number>> {
  try {
    const command = [
      "$ErrorActionPreference='Stop'",
      "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1}' -f $_.ProcessId,$_.ParentProcessId }",
    ].join('; ');
    const { stdout } = await execFileText('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command,
    ]);
    const rows = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)$/u))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({
        pid: Number(match[1]),
        parentPid: Number(match[2]),
      }));
    return collectDescendants(rows, rootPid, false);
  } catch {
    return new Set([rootPid]);
  }
}

function collectDescendants(
  rows: ProcessRow[],
  rootPid: number,
  includeProcessGroup: boolean,
): Set<number> {
  const members = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (members.has(row.parentPid) && !members.has(row.pid)) {
        members.add(row.pid);
        changed = true;
      }
      if (includeProcessGroup && row.groupPid === rootPid) {
        members.add(row.pid);
      }
    }
  }
  return members;
}

async function runTaskkill(pid: number, force: boolean): Promise<void> {
  const args = ['/PID', String(pid), '/T'];
  if (force) args.push('/F');
  await execFileText('taskkill.exe', args).catch(() => undefined);
}

async function waitForPidsExit(
  pids: Set<number>,
  timeoutMs: number,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let residualPids: number[] = [];
  do {
    residualPids = [...pids].filter(isPidAlive);
    if (residualPids.length === 0) return [];
    await delay(PROCESS_POLL_MS);
  } while (Date.now() < deadline);
  return residualPids.sort((left, right) => left - right);
}

function signalPosixGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function execFileText(
  executable: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: PROCESS_LIST_TIMEOUT_MS,
      maxBuffer: PROCESS_LIST_MAX_BYTES,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function formatTermination(report: ProcessTerminationReport): string {
  if (report.confirmed) {
    return report.forced
      ? 'process tree required forced termination and exit was confirmed'
      : 'process tree exited after graceful termination';
  }
  return `process tree termination left residual PIDs: ${report.residualPids.join(', ')}`;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
