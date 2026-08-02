import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER_BYTES = 512 * 1024;
const CONFIGURED_HELPER_PATTERN = '^(filter\\..*\\.(clean|smudge|process)|diff\\..*\\.(command|textconv))$';
const disabledHooksPath = path.join(os.tmpdir(), 'openbrowser-disabled-git-hooks');

const blockedEnvironmentNames = new Set([
  'EDITOR',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_ASKPASS',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG_PARAMETERS',
  'GIT_DIR',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_EDITOR',
  'GIT_EXEC_PATH',
  'GIT_EXTERNAL_DIFF',
  'GIT_EXTERNAL_DIFF_TRUST_EXIT_CODE',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PAGER',
  'GIT_PROXY_COMMAND',
  'GIT_SEQUENCE_EDITOR',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_SSH_VARIANT',
  'GIT_WORK_TREE',
  'PAGER',
  'SSH_ASKPASS',
  'VISUAL',
]);

export interface HardenedGitInvocation {
  executable: 'git';
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface HardenedGitResult {
  stdout: string;
  stderr: string;
}

export interface HardenedGitRunOptions {
  env?: NodeJS.ProcessEnv;
  rejectConfiguredHelpers?: boolean;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

export class GitConfiguredHelperError extends Error {
  constructor(public readonly configKeys: string[]) {
    super(`Configured Git helpers require explicit approval: ${configKeys.join(', ')}`);
    this.name = 'GitConfiguredHelperError';
  }
}

export function createHardenedGitEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(source)) {
    const normalized = key.toUpperCase();
    if (
      blockedEnvironmentNames.has(normalized)
      || normalized.startsWith('GIT_CONFIG_')
      || normalized.startsWith('GIT_TRACE')
    ) {
      continue;
    }
    environment[key] = value;
  }

  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_ATTR_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: '',
    PAGER: '',
    GIT_EDITOR: '',
    GIT_SEQUENCE_EDITOR: '',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  };
}

export function buildHardenedGitInvocation(
  commandArgs: string[],
  environment: NodeJS.ProcessEnv = process.env,
): HardenedGitInvocation {
  return {
    executable: 'git',
    args: [
      '--no-pager',
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=false',
      '-c',
      `core.hooksPath=${disabledHooksPath}`,
      '-c',
      'diff.external=',
      '-c',
      'interactive.diffFilter=',
      '-c',
      'core.askPass=',
      '-c',
      'credential.helper=',
      ...commandArgs,
    ],
    env: createHardenedGitEnvironment(environment),
  };
}

export async function runHardenedGit(
  cwd: string,
  commandArgs: string[],
  options: HardenedGitRunOptions = {},
): Promise<HardenedGitResult> {
  if (options.rejectConfiguredHelpers) {
    const configKeys = await findConfiguredGitHelpers(cwd, options.env ?? process.env, options);
    if (configKeys.length > 0) {
      throw new GitConfiguredHelperError(configKeys);
    }
  }

  return executeGit(
    buildHardenedGitInvocation(commandArgs, options.env ?? process.env),
    cwd,
    options,
  );
}

async function findConfiguredGitHelpers(
  cwd: string,
  environment: NodeJS.ProcessEnv,
  options: HardenedGitRunOptions,
): Promise<string[]> {
  const invocation = buildHardenedGitInvocation([
    'config',
    '--local',
    '--includes',
    '--name-only',
    '--get-regexp',
    CONFIGURED_HELPER_PATTERN,
  ], environment);

  try {
    const result = await executeGit(invocation, cwd, options);
    return [...new Set(result.stdout
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isExitCode(error, 1)) {
      return [];
    }
    throw error;
  }
}

function executeGit(
  invocation: HardenedGitInvocation,
  cwd: string,
  options: HardenedGitRunOptions,
): Promise<HardenedGitResult> {
  return new Promise((resolve, reject) => {
    execFile(invocation.executable, invocation.args, {
      cwd,
      env: invocation.env,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
      windowsHide: true,
      shell: false,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function isExitCode(error: unknown, expected: number): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === expected,
  );
}
