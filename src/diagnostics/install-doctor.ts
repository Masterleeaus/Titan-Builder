import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnvironmentText } from '../config/environment.js';
import { listProjects, type ProjectRecord } from '../projects/registry.js';
import type { ServiceStatus } from '../service/service-manager.js';

export type InstallDoctorStatus = 'pass' | 'warn' | 'fail';

export interface InstallDoctorCheck {
  id: string;
  status: InstallDoctorStatus;
  summary: string;
  detail?: string;
  remediation?: string;
}

export interface InstallDoctorReport {
  ok: boolean;
  generatedAt: string;
  checks: InstallDoctorCheck[];
}

export interface InstallDoctorOptions {
  homeDir?: string;
  packageRoot?: string;
  nodeVersion?: string;
  env?: NodeJS.ProcessEnv;
  readText?: (filePath: string) => Promise<string>;
  serviceStatus?: () => Promise<ServiceStatus>;
  projects?: () => Promise<ProjectRecord[]>;
  isProcessRunning?: (pid: number) => boolean;
  probeBridge?: (port: number) => Promise<boolean>;
  now?: () => Date;
}

export async function runInstallDoctor(
  options: InstallDoctorOptions = {},
): Promise<InstallDoctorReport> {
  const homeDir = options.homeDir ?? os.homedir();
  const packageRoot = options.packageRoot ?? resolvePackageRoot();
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const env = options.env ?? process.env;
  const readText = options.readText ?? ((filePath: string) => readFile(filePath, 'utf8'));
  const serviceStatus = options.serviceStatus ?? (() => inspectServiceStatus({
    homeDir,
    port: normalizePort(env.PORT),
    readText,
    isProcessRunning: options.isProcessRunning ?? processIsRunning,
    probeBridge: options.probeBridge ?? probeLocalBridge,
  }));
  const projects = options.projects ?? (() => listProjects({ homeDir }));
  const now = options.now ?? (() => new Date());

  const checks: InstallDoctorCheck[] = [];
  checks.push(checkNodeVersion(nodeVersion));

  const config = await resolveConfiguration({
    env,
    homeDir,
    packageRoot,
    readText,
  });
  checks.push(config.fileCheck);
  checks.push(checkToken('config.control-token', 'control', config.values.BRIDGE_TOKEN));
  checks.push(
    checkToken('config.browser-token', 'browser', config.values.BRIDGE_BROWSER_TOKEN),
  );
  checks.push(
    checkTokenSeparation(
      config.values.BRIDGE_TOKEN,
      config.values.BRIDGE_BROWSER_TOKEN,
    ),
  );
  checks.push(checkSecureMode(config.values));

  checks.push(
    await checkJsonAsset({
      id: 'extension.manifest',
      filePath: path.join(packageRoot, 'browser-extension', 'manifest.json'),
      label: 'Chrome extension manifest',
      readText,
      validate: (value) =>
        Boolean(value && typeof value === 'object' && (value as { manifest_version?: unknown }).manifest_version === 3),
      remediation: 'Reinstall from a complete Titan Builder checkout containing browser-extension/manifest.json.',
    }),
  );
  checks.push(
    await checkJsonAsset({
      id: 'companion.package',
      filePath: path.join(packageRoot, 'browser-extension', 'package.json'),
      label: 'browser-extension companion package',
      readText,
      validate: (value) => Boolean(value && typeof value === 'object'),
      remediation: 'Reinstall from a complete Titan Builder checkout containing browser-extension/package.json.',
    }),
  );

  checks.push(await checkProjects(projects));
  checks.push(await checkService(serviceStatus));

  return {
    ok: !checks.some((check) => check.status === 'fail'),
    generatedAt: now().toISOString(),
    checks,
  };
}

function checkNodeVersion(nodeVersion: string): InstallDoctorCheck {
  const major = Number.parseInt(String(nodeVersion).replace(/^v/u, '').split('.')[0] ?? '', 10);
  if (Number.isInteger(major) && major >= 22) {
    return {
      id: 'runtime.node',
      status: 'pass',
      summary: `Node.js ${nodeVersion} satisfies the Node.js 22+ requirement.`,
    };
  }
  return {
    id: 'runtime.node',
    status: 'fail',
    summary: `Node.js ${nodeVersion || 'unknown'} does not satisfy the Node.js 22+ requirement.`,
    remediation: 'Install Node.js 22 or later and run the installer again.',
  };
}

async function resolveConfiguration(input: {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  packageRoot: string;
  readText: (filePath: string) => Promise<string>;
}): Promise<{
  values: Record<string, string>;
  fileCheck: InstallDoctorCheck;
}> {
  const candidates = [
    input.env.OPENBROWSER_CONFIG,
    path.join(input.homeDir, '.openbrowser', '.env'),
    path.join(input.packageRoot, '.env'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      const values = parseEnvironmentText(await input.readText(candidate));
      return {
        values,
        fileCheck: {
          id: 'config.file',
          status: 'pass',
          summary: 'OpenBrowser configuration is readable.',
          detail: candidate,
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      return {
        values: {},
        fileCheck: {
          id: 'config.file',
          status: 'fail',
          summary: 'OpenBrowser configuration could not be read.',
          detail: candidate,
          remediation: 'Repair file permissions or replace the configuration with a valid UTF-8 .env file.',
        },
      };
    }
  }

  return {
    values: {},
    fileCheck: {
      id: 'config.file',
      status: 'fail',
      summary: 'OpenBrowser configuration was not found.',
      detail: path.join(input.homeDir, '.openbrowser', '.env'),
      remediation: 'Run scripts/install-windows.ps1 or create ~/.openbrowser/.env with distinct secure bridge tokens.',
    },
  };
}

function checkToken(
  id: 'config.control-token' | 'config.browser-token',
  label: 'control' | 'browser',
  value: string | undefined,
): InstallDoctorCheck {
  if (typeof value === 'string' && value.length >= 32) {
    return {
      id,
      status: 'pass',
      summary: `A strong ${label} bridge token is configured.`,
    };
  }
  return {
    id,
    status: 'fail',
    summary: `The ${label} bridge token is missing or shorter than 32 characters.`,
    remediation: 'Run the Windows installer to generate missing secure credentials.',
  };
}

function checkTokenSeparation(
  controlToken: string | undefined,
  browserToken: string | undefined,
): InstallDoctorCheck {
  if (
    typeof controlToken === 'string' &&
    typeof browserToken === 'string' &&
    controlToken.length >= 32 &&
    browserToken.length >= 32 &&
    controlToken !== browserToken
  ) {
    return {
      id: 'config.token-separation',
      status: 'pass',
      summary: 'Control and browser credentials are distinct.',
    };
  }
  return {
    id: 'config.token-separation',
    status: 'fail',
    summary: 'Control and browser credentials are missing, weak, or identical.',
    remediation: 'Generate separate BRIDGE_TOKEN and BRIDGE_BROWSER_TOKEN values; copy only the browser token into Chrome.',
  };
}

function checkSecureMode(values: Record<string, string>): InstallDoctorCheck {
  if (values.OPENBROWSER_INSECURE_DEV === '1') {
    return {
      id: 'config.secure-mode',
      status: 'fail',
      summary: 'Insecure development mode is enabled.',
      remediation: 'Set OPENBROWSER_INSECURE_DEV=0 before using browser-first workflows.',
    };
  }
  if (values.OPENBROWSER_ALLOW_UNSAFE_COMMANDS === '1') {
    return {
      id: 'config.secure-mode',
      status: 'warn',
      summary: 'Legacy unsafe command execution is enabled.',
      remediation: 'Set OPENBROWSER_ALLOW_UNSAFE_COMMANDS=0 unless a specific local workflow requires it.',
    };
  }
  return {
    id: 'config.secure-mode',
    status: 'pass',
    summary: 'Secure bridge defaults are enabled.',
  };
}

async function checkJsonAsset(input: {
  id: 'extension.manifest' | 'companion.package';
  filePath: string;
  label: string;
  readText: (filePath: string) => Promise<string>;
  validate: (value: unknown) => boolean;
  remediation: string;
}): Promise<InstallDoctorCheck> {
  try {
    const value: unknown = JSON.parse(await input.readText(input.filePath));
    if (!input.validate(value)) throw new Error('invalid structure');
    return {
      id: input.id,
      status: 'pass',
      summary: `The ${input.label} is present and valid.`,
      detail: input.filePath,
    };
  } catch {
    return {
      id: input.id,
      status: 'fail',
      summary: `The ${input.label} is missing or invalid.`,
      detail: input.filePath,
      remediation: input.remediation,
    };
  }
}

async function checkProjects(
  projects: () => Promise<ProjectRecord[]>,
): Promise<InstallDoctorCheck> {
  try {
    const records = await projects();
    if (records.length > 0) {
      return {
        id: 'projects.registry',
        status: 'pass',
        summary: `${records.length} registered project${records.length === 1 ? '' : 's'} available.`,
      };
    }
    return {
      id: 'projects.registry',
      status: 'warn',
      summary: 'No projects are registered for the Work view.',
      remediation: 'Run openbrowser project add . from the project you want to use.',
    };
  } catch (error) {
    return {
      id: 'projects.registry',
      status: 'fail',
      summary: 'The project registry could not be read.',
      detail: formatError(error),
      remediation: 'Repair ~/.openbrowser/projects.json or register the project again.',
    };
  }
}

async function checkService(
  serviceStatus: () => Promise<ServiceStatus>,
): Promise<InstallDoctorCheck> {
  try {
    const status = await serviceStatus();
    if (status.status === 'running' && status.healthy) {
      return {
        id: 'service.bridge',
        status: 'pass',
        summary: `The local bridge is running and healthy${status.pid ? ` (PID ${status.pid})` : ''}.`,
        detail: status.logPath,
      };
    }
    if (status.status === 'running') {
      return {
        id: 'service.bridge',
        status: 'fail',
        summary: 'The local bridge process is running but its health check failed.',
        detail: status.logPath,
        remediation: 'Run openbrowser service logs, then restart the service after resolving the reported error.',
      };
    }
    return {
      id: 'service.bridge',
      status: 'warn',
      summary: status.staleMetadata
        ? 'The local bridge service is stopped and stale service metadata remains.'
        : 'The local bridge service is stopped.',
      detail: status.logPath,
      remediation: status.staleMetadata
        ? 'Run openbrowser service status to clean stale metadata, then start the service.'
        : 'Run openbrowser service start before using the Chrome Work view.',
    };
  } catch (error) {
    return {
      id: 'service.bridge',
      status: 'fail',
      summary: 'The local bridge service status could not be determined.',
      detail: formatError(error),
      remediation: 'Run openbrowser service status and inspect the service logs.',
    };
  }
}

async function inspectServiceStatus(input: {
  homeDir: string;
  port: number;
  readText: (filePath: string) => Promise<string>;
  isProcessRunning: (pid: number) => boolean;
  probeBridge: (port: number) => Promise<boolean>;
}): Promise<ServiceStatus> {
  const serviceRoot = path.join(input.homeDir, '.openbrowser');
  const metadataPath = path.join(serviceRoot, 'service.json');
  const defaultLogPath = path.join(serviceRoot, 'logs', 'service.log');

  try {
    const parsed = JSON.parse(await input.readText(metadataPath)) as {
      version?: unknown;
      pid?: unknown;
      startedAt?: unknown;
      logPath?: unknown;
    };
    if (
      parsed.version !== 1 ||
      !Number.isInteger(parsed.pid) ||
      Number(parsed.pid) <= 0 ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.logPath !== 'string'
    ) {
      return {
        status: 'stopped',
        logPath: defaultLogPath,
        staleMetadata: true,
      };
    }

    const pid = Number(parsed.pid);
    if (!input.isProcessRunning(pid)) {
      return {
        status: 'stopped',
        logPath: parsed.logPath,
        staleMetadata: true,
      };
    }

    return {
      status: 'running',
      pid,
      startedAt: parsed.startedAt,
      logPath: parsed.logPath,
      healthy: await input.probeBridge(input.port),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'stopped', logPath: defaultLogPath };
    }
    if (error instanceof SyntaxError) {
      return {
        status: 'stopped',
        logPath: defaultLogPath,
        staleMetadata: true,
      };
    }
    throw error;
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
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

function normalizePort(value: string | undefined): number {
  const parsed = Number(value ?? 5000);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : 5000;
}

function resolvePackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
