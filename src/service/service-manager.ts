import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServiceMetadata {
  version: 1;
  pid: number;
  entryPath: string;
  startedAt: string;
  logPath: string;
  nonce: string;
}

export interface ServiceStatus {
  status: 'running' | 'stopped';
  pid?: number;
  startedAt?: string;
  logPath: string;
  healthy?: boolean;
  staleMetadata?: boolean;
  alreadyRunning?: boolean;
}

export interface ServiceManagerOptions {
  homeDir?: string;
  entryPath?: string;
  port?: number;
  maxLogBytes?: number;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  pollIntervalMs?: number;
  spawnProcess?: (
    command: string,
    args: string[],
    options: {
      detached: boolean;
      windowsHide: boolean;
      cwd: string;
      env: NodeJS.ProcessEnv;
      stdio: ['ignore', number, number];
    },
  ) => { pid?: number; unref(): void };
  isProcessRunning?: (pid: number) => boolean;
  terminateProcess?: (pid: number, signal: NodeJS.Signals) => void;
  probeBridge?: () => Promise<boolean>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

export interface ServiceManager {
  ensureDirectories(): Promise<void>;
  start(): Promise<ServiceStatus>;
  status(): Promise<ServiceStatus>;
  stop(): Promise<ServiceStatus>;
  logs(lines?: number): Promise<string>;
}

const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

export function getServicePaths(options: Pick<ServiceManagerOptions, 'homeDir'> = {}) {
  const root = path.join(options.homeDir ?? os.homedir(), '.openbrowser');
  const logsDir = path.join(root, 'logs');
  const logPath = path.join(logsDir, 'service.log');
  return {
    root,
    logsDir,
    metadataPath: path.join(root, 'service.json'),
    logPath,
    rotatedLogPath: `${logPath}.1`,
  };
}

export function createServiceManager(options: ServiceManagerOptions = {}): ServiceManager {
  const paths = getServicePaths(options);
  const entryPath = options.entryPath ?? fileURLToPath(new URL('./service-entry.js', import.meta.url));
  const port = normalizePositiveInteger(options.port, Number(process.env.PORT ?? 5000));
  const maxLogBytes = normalizePositiveInteger(options.maxLogBytes, DEFAULT_MAX_LOG_BYTES);
  const startupTimeoutMs = normalizePositiveInteger(
    options.startupTimeoutMs,
    DEFAULT_STARTUP_TIMEOUT_MS,
  );
  const stopTimeoutMs = normalizePositiveInteger(options.stopTimeoutMs, DEFAULT_STOP_TIMEOUT_MS);
  const pollIntervalMs = normalizePositiveInteger(
    options.pollIntervalMs,
    DEFAULT_POLL_INTERVAL_MS,
  );
  const spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) =>
    spawn(command, args, spawnOptions));
  const isProcessRunning = options.isProcessRunning ?? processIsRunning;
  const terminateProcess = options.terminateProcess ?? ((pid, signal) => process.kill(pid, signal));
  const probeBridge = options.probeBridge ?? (() => probeLocalBridge(port));
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? (() => new Date());

  const ensureDirectories = async (): Promise<void> => {
    await mkdir(paths.logsDir, { recursive: true, mode: 0o700 });
  };

  const readMetadata = async (): Promise<ServiceMetadata | null> => {
    try {
      const parsed = JSON.parse(await readFile(paths.metadataPath, 'utf8')) as Partial<ServiceMetadata>;
      if (
        parsed.version === 1 &&
        Number.isInteger(parsed.pid) &&
        Number(parsed.pid) > 0 &&
        typeof parsed.entryPath === 'string' &&
        typeof parsed.startedAt === 'string' &&
        typeof parsed.logPath === 'string'
      ) {
        return {
          version: 1,
          pid: parsed.pid as number,
          entryPath: parsed.entryPath,
          startedAt: parsed.startedAt,
          logPath: parsed.logPath,
          nonce: parsed.nonce ?? 'legacy',
        };
      }
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  };

  const removeMetadata = async (): Promise<void> => {
    try {
      await unlink(paths.metadataPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };

  const writeMetadata = async (metadata: ServiceMetadata): Promise<void> => {
    await ensureDirectories();
    const tempPath = `${paths.metadataPath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, paths.metadataPath);
  };

  const rotateLogIfNeeded = async (): Promise<void> => {
    try {
      const details = await stat(paths.logPath);
      if (details.size <= maxLogBytes) return;
      try {
        await unlink(paths.rotatedLogPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rename(paths.logPath, paths.rotatedLogPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };

  const waitForProbe = async (expected: boolean, timeoutMs: number): Promise<boolean> => {
    const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if ((await probeBridge()) === expected) return true;
      if (attempt + 1 < attempts) await sleep(pollIntervalMs);
    }
    return false;
  };

  const stopPid = async (pid: number): Promise<void> => {
    if (!isProcessRunning(pid)) return;
    terminateProcess(pid, 'SIGTERM');
    const stoppedGracefully = await waitForProcessExit(
      pid,
      isProcessRunning,
      sleep,
      stopTimeoutMs,
      pollIntervalMs,
    );
    if (!stoppedGracefully && isProcessRunning(pid)) {
      terminateProcess(pid, 'SIGKILL');
      await waitForProcessExit(
        pid,
        isProcessRunning,
        sleep,
        Math.min(stopTimeoutMs, 1_000),
        pollIntervalMs,
      );
    }
  };

  return {
    ensureDirectories,

    async status() {
      const metadata = await readMetadata();
      if (!metadata) return { status: 'stopped', logPath: paths.logPath };
      if (!isProcessRunning(metadata.pid)) {
        await removeMetadata();
        return { status: 'stopped', logPath: paths.logPath, staleMetadata: true };
      }
      const healthy = await probeBridge();
      if (healthy && metadata.entryPath !== entryPath) {
        await removeMetadata();
        return {
          status: 'stopped',
          logPath: paths.logPath,
          staleMetadata: true,
        };
      }
      return {
        status: 'running',
        pid: metadata.pid,
        startedAt: metadata.startedAt,
        logPath: metadata.logPath,
        healthy,
      };
    },

    async start() {
      const current = await this.status();
      if (current.status === 'running') return { ...current, alreadyRunning: true };
      if (await probeBridge()) {
        throw new Error(
          `A bridge is already responding on 127.0.0.1:${port}, but it is not managed by this service.`,
        );
      }
      await ensureDirectories();
      await rotateLogIfNeeded();
      mkdirSync(paths.logsDir, { recursive: true, mode: 0o700 });
      const logFd = openSync(paths.logPath, 'a');
      let child: { pid?: number; unref(): void };
      try {
        child = spawnProcess(process.execPath, [entryPath], {
          detached: true,
          windowsHide: true,
          cwd: process.cwd(),
          env: { ...process.env, OPENBROWSER_SERVICE: '1', PORT: String(port) },
          stdio: ['ignore', logFd, logFd],
        });
      } finally {
        closeSync(logFd);
      }
      if (!child.pid) throw new Error('OpenBrowser service failed to return a process id');
      child.unref();
      const metadata: ServiceMetadata = {
        version: 1,
        pid: child.pid,
        entryPath,
        startedAt: now().toISOString(),
        logPath: paths.logPath,
        nonce: crypto.randomUUID(),
      };
      await writeMetadata(metadata);
      if (!(await waitForProbe(true, startupTimeoutMs))) {
        await stopPid(child.pid);
        await removeMetadata();
        throw new Error(`OpenBrowser service health check failed on 127.0.0.1:${port}`);
      }
      return {
        status: 'running',
        pid: metadata.pid,
        startedAt: metadata.startedAt,
        logPath: metadata.logPath,
        healthy: true,
        alreadyRunning: false,
      };
    },

    async stop() {
      const metadata = await readMetadata();
      if (!metadata) return { status: 'stopped', logPath: paths.logPath };
      await stopPid(metadata.pid);
      await removeMetadata();
      return { status: 'stopped', logPath: paths.logPath };
    },

    async logs(lines = 100) {
      const count = Number.isFinite(lines) ? Math.max(1, Math.min(5000, Math.trunc(lines))) : 100;
      try {
        const entries = (await readFile(paths.logPath, 'utf8')).split(/\r?\n/u);
        while (entries.at(-1) === '') entries.pop();
        return entries.slice(-count).join('\n');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw error;
      }
    },
  };
}

async function probeLocalBridge(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
      headers: { Accept: 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForProcessExit(
  pid: number,
  isProcessRunning: (pid: number) => boolean,
  sleep: (milliseconds: number) => Promise<void>,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!isProcessRunning(pid)) return true;
    if (attempt + 1 < attempts) await sleep(pollIntervalMs);
  }
  return !isProcessRunning(pid);
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.round(Number(value)) : fallback;
}
