import path from 'node:path';

export type ToolRisk =
  | 'READ'
  | 'SAFE_EXECUTION'
  | 'WRITE'
  | 'NETWORK_WRITE'
  | 'ARBITRARY_EXECUTION'
  | 'DESTRUCTIVE'
  | 'PUBLISH';

export type ToolId =
  | 'git.status'
  | 'git.diff'
  | 'git.log'
  | 'git.branch.current'
  | 'npm.install'
  | 'npm.test'
  | 'npm.run'
  | 'pnpm.install'
  | 'pnpm.test'
  | 'pnpm.run'
  | 'node.version'
  | 'vscode.open';

export interface ToolInputFile {
  path: string;
  required: boolean;
}

export interface ToolInvocation {
  toolId: ToolId;
  executable: string;
  args: string[];
  cwd: string;
  risk: ToolRisk;
  displayCommand: string;
  shell: false;
}

const APPROVED_SCRIPT = /^(?:test|build|lint|typecheck|check|verify)(?::[A-Za-z0-9_-]+)*$/;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9_./\\ -]+$/;

export function isUnsafeLegacyCommandEnabled(): boolean {
  return process.env.OPENBROWSER_ALLOW_UNSAFE_COMMANDS === '1';
}

export function resolveToolInvocation(
  toolId: string,
  args: string[] = [],
  projectRoot: string,
): ToolInvocation {
  const cwd = path.resolve(projectRoot);
  const normalizedArgs = args.map(validateArgument);
  const validatedToolId = assertToolId(toolId);

  switch (validatedToolId) {
    case 'git.status':
      requireArgCount(validatedToolId, normalizedArgs, 0);
      return invocation(validatedToolId, 'git', ['status', '--short', '--branch'], cwd, 'READ');
    case 'git.diff': {
      if (normalizedArgs.length > 1 || (normalizedArgs[0] && normalizedArgs[0] !== '--staged')) {
        throw new Error('git.diff accepts no arguments or only --staged');
      }
      return invocation(validatedToolId, 'git', ['diff', ...normalizedArgs], cwd, 'READ');
    }
    case 'git.log': {
      if (normalizedArgs.length > 1) {
        throw new Error('git.log accepts at most one numeric count argument');
      }
      const count = normalizedArgs[0] ?? '20';
      if (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 100) {
        throw new Error('git.log count must be an integer between 1 and 100');
      }
      return invocation(validatedToolId, 'git', ['log', '--oneline', '--decorate', '-n', count], cwd, 'READ');
    }
    case 'git.branch.current':
      requireArgCount(validatedToolId, normalizedArgs, 0);
      return invocation(validatedToolId, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 'READ');
    case 'npm.install':
      requireArgCount(validatedToolId, normalizedArgs, 0);
      return invocation(validatedToolId, platformCommand('npm'), ['ci', '--ignore-scripts'], cwd, 'NETWORK_WRITE');
    case 'npm.test':
      requireArgCount(validatedToolId, normalizedArgs, 0);
      return invocation(validatedToolId, platformCommand('npm'), ['test'], cwd, 'ARBITRARY_EXECUTION');
    case 'npm.run':
      return runScriptInvocation(validatedToolId, platformCommand('npm'), normalizedArgs, cwd);
    case 'pnpm.install':
      requireArgCount(validatedToolId, normalizedArgs, 0);
      return invocation(
        validatedToolId,
        platformCommand('pnpm'),
        ['install', '--frozen-lockfile', '--ignore-scripts'],
        cwd,
        'NETWORK_WRITE',
      );
    case 'pnpm.test':
      requireArgCount(validatedToolId, normalizedArgs, 0);
      return invocation(validatedToolId, platformCommand('pnpm'), ['test'], cwd, 'ARBITRARY_EXECUTION');
    case 'pnpm.run':
      return runScriptInvocation(validatedToolId, platformCommand('pnpm'), normalizedArgs, cwd);
    case 'node.version':
      requireArgCount(validatedToolId, normalizedArgs, 0);
      return invocation(validatedToolId, process.execPath, ['--version'], cwd, 'READ');
    case 'vscode.open': {
      if (normalizedArgs.length > 1) {
        throw new Error('vscode.open accepts at most one project-relative path');
      }
      const target = normalizedArgs[0] ?? '.';
      if (!SAFE_RELATIVE_PATH.test(target) || path.isAbsolute(target) || target.split(/[\\/]/).includes('..')) {
        throw new Error('vscode.open path must stay inside the project root');
      }
      return invocation(validatedToolId, platformCommand('code'), [target], cwd, 'SAFE_EXECUTION');
    }
    default:
      throw new Error(`Unsupported tool: ${toolId}`);
  }
}



export function requiresExplicitApproval(risk: ToolRisk): boolean {
  return risk === 'NETWORK_WRITE'
    || risk === 'ARBITRARY_EXECUTION'
    || risk === 'DESTRUCTIVE'
    || risk === 'PUBLISH';
}

export function toolInputFiles(invocation: ToolInvocation): ToolInputFile[] {
  switch (invocation.toolId) {
    case 'npm.install':
      return [
        { path: 'package.json', required: true },
        { path: 'package-lock.json', required: true },
        { path: '.npmrc', required: false },
      ];
    case 'npm.test':
    case 'npm.run':
      return [
        { path: 'package.json', required: true },
        { path: 'package-lock.json', required: false },
        { path: '.npmrc', required: false },
      ];
    case 'pnpm.install':
      return [
        { path: 'package.json', required: true },
        { path: 'pnpm-lock.yaml', required: true },
        { path: 'pnpm-workspace.yaml', required: false },
        { path: '.npmrc', required: false },
      ];
    case 'pnpm.test':
    case 'pnpm.run':
      return [
        { path: 'package.json', required: true },
        { path: 'pnpm-lock.yaml', required: false },
        { path: 'pnpm-workspace.yaml', required: false },
        { path: '.npmrc', required: false },
      ];
    default:
      return [];
  }
}

function assertToolId(value: string): ToolId {
  const supported: readonly ToolId[] = [
    'git.status',
    'git.diff',
    'git.log',
    'git.branch.current',
    'npm.install',
    'npm.test',
    'npm.run',
    'pnpm.install',
    'pnpm.test',
    'pnpm.run',
    'node.version',
    'vscode.open',
  ];

  if (!supported.includes(value as ToolId)) {
    throw new Error(`Unsupported tool: ${value}`);
  }

  return value as ToolId;
}

function runScriptInvocation(
  toolId: ToolId,
  executable: string,
  args: string[],
  cwd: string,
): ToolInvocation {
  if (args.length !== 1) {
    throw new Error(`${toolId} requires exactly one script name`);
  }
  const script = args[0] ?? '';
  if (!APPROVED_SCRIPT.test(script)) {
    throw new Error(`${script || '(empty)'} is not an approved verification script`);
  }
  return invocation(toolId, executable, ['run', script], cwd, 'ARBITRARY_EXECUTION');
}

function invocation(
  toolId: ToolId,
  executable: string,
  args: string[],
  cwd: string,
  risk: ToolRisk,
): ToolInvocation {
  return {
    toolId,
    executable,
    args,
    cwd,
    risk,
    displayCommand: [quoteDisplay(executable), ...args.map(quoteDisplay)].join(' '),
    shell: false,
  };
}

function validateArgument(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('Tool arguments must be strings');
  }
  if (value.length > 300) {
    throw new Error('Tool argument exceeds 300 characters');
  }
  if (/\0|\r|\n/.test(value)) {
    throw new Error('Tool arguments must not contain control characters');
  }
  return value;
}

function requireArgCount(toolId: string, args: string[], count: number): void {
  if (args.length !== count) {
    throw new Error(`${toolId} accepts ${count === 0 ? 'no arguments' : `${count} argument(s)`}`);
  }
}

function platformCommand(command: string): string {
  return process.platform === 'win32' ? `${command}.cmd` : command;
}

function quoteDisplay(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}
