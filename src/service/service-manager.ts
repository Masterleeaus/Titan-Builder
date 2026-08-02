import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServiceMetadata {
  version: 1;
  pid: number;
  entryPath: string;
  startedAt: string;
  logPath: string;
}

export interface ServiceStatus {
  status: 'running' | 'stopped';
  pid?: number;
  startedAt?: string;
  logPath: string;
  staleMetadata?: boolean;
  alreadyRunning?: boolean;
}

export interface ServiceManagerOptions {
  homeDir?: string;
  entryPath?: string;
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
  terminateProcess?: (pid: number) => void;
  now?: () => Date;
}

export interface ServiceManager {
  ensureDirectories(): Promise<void>;
  start(): Promise<ServiceStatus>;
  status(): Promise<ServiceStatus>;
  stop(): Promise<ServiceStatus>;
  logs(lines?: number): Promise<string>;
}

export function getServicePaths(options: Pick<ServiceManagerOptions, 'homeDir'> = {}) {
  const root = path.join(options.homeDir ?? os.homedir(), '.openbrowser');
  const logsDir = path.join(root, 'logs');
  return {
    root,
    logsDir,
    metadataPath: path.join(root, 'service.json'),
    logPath: path.join(logsDir, 'service.log'),
  };
}

export function createServiceManager(options: ServiceManagerOptions = {}): ServiceManager {
  const paths = getServicePaths(options);
  const entryPath = options.entryPath ?? fileURLToPath(new URL('./service-entry.js', import.meta.url));
  const spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) =>
    spawn(command, args, spawnOptions));
  const isProcessRunning = options.isProcessRunning ?? processIsRunning;
  const terminateProcess = options.terminateProcess ?? ((pid) => process.kill(pid, 'SIGTERM'));
  const now = options.now ?? (() => new Date());

  const ensureDirectories = async (): Promise<void> => {
    await mkdir(paths.logsDir, { recursive: true });
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
        return parsed as ServiceMetadata;
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
    await writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    await rename(tempPath, paths.metadataPath);
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
      return {
        status: 'running',
        pid: metadata.pid,
        startedAt: metadata.startedAt,
        logPath: metadata.logPath,
      };
    },

    async start() {
      const current = await this.status();
      if (current.status === 'running') return { ...current, alreadyRunning: true };
      await ensureDirectories();
      mkdirSync(paths.logsDir, { recursive: true });
      const logFd = openSync(paths.logPath, 'a');
      let child: { pid?: number; unref(): void };
      try {
        child = spawnProcess(process.execPath, [entryPath], {
          detached: true,
          windowsHide: true,
          cwd: process.cwd(),
          env: { ...process.env, OPENBROWSER_SERVICE: '1' },
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
      };
      await writeMetadata(metadata);
      return {
        status: 'running',
        pid: metadata.pid,
        startedAt: metadata.startedAt,
        logPath: metadata.logPath,
        alreadyRunning: false,
      };
    },

    async stop() {
      const metadata = await readMetadata();
      if (!metadata) return { status: 'stopped', logPath: paths.logPath };
      if (isProcessRunning(metadata.pid)) terminateProcess(metadata.pid);
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

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
