import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER_BYTES = 512 * 1024;
const disabledHooksPath = path.join(os.tmpdir(), 'openbrowser-disabled-git-hooks')
  .replaceAll('\\', '/');

const trustedCommandConfig = [
  ['core.fsmonitor', 'false'],
  ['core.hooksPath', disabledHooksPath],
  ['diff.external', ''],
  ['interactive.diffFilter', ''],
  ['core.askPass', ''],
  ['credential.helper', ''],
] as const;

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
  timeoutMs?: number;
  maxBufferBytes?: number;
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

  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_CONFIG_SYSTEM = os.devNull;
  environment.GIT_CONFIG_GLOBAL = os.devNull;
  environment.GIT_ATTR_NOSYSTEM = '1';
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.GIT_PAGER = '';
  environment.PAGER = '';
  environment.GIT_EDITOR = '';
  environment.GIT_SEQUENCE_EDITOR = '';
  environment.GIT_ASKPASS = '';
  environment.SSH_ASKPASS = '';
  environment.GIT_CONFIG_COUNT = '0';

  return environment;
}

export function buildHardenedGitInvocation(
  commandArgs: string[],
  environment: NodeJS.ProcessEnv = process.env,
): HardenedGitInvocation {
  const trustedConfigArgs = trustedCommandConfig.flatMap(([key, value]) => [
    '-c',
    `${key}=${value}`,
  ]);

  return {
    executable: 'git',
    args: [
      '--no-pager',
      '--no-optional-locks',
      ...trustedConfigArgs,
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
  const invocation = buildHardenedGitInvocation(commandArgs, options.env ?? process.env);
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
