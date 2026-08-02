import type { TitanToolManifest, ToolRisk } from './manifest.js';
import {
  builtinToolRegistry,
  requiresExplicitApproval,
  type ToolId,
} from './catalog.js';
import type { ToolInputFile, ToolInvocation } from './types.js';
import { validateResolvedToolInvocation } from './validation.js';

export type { ToolId, ToolInputFile, ToolInvocation, ToolRisk };
export { requiresExplicitApproval };

export function isUnsafeLegacyCommandEnabled(): boolean {
  return process.env.OPENBROWSER_ALLOW_UNSAFE_COMMANDS === '1';
}

export function resolveToolInvocation(
  toolId: string,
  args: string[] = [],
  projectRoot: string,
): ToolInvocation {
  const definition = builtinToolRegistry.resolve(toolId);
  if (!definition) {
    throw new Error(`Unsupported tool: ${toolId}`);
  }
  return validateResolvedToolInvocation(
    definition.manifest,
    definition.resolve(args, projectRoot),
  );
}

export function toolInputFiles(invocation: ToolInvocation): ToolInputFile[] {
  const definition = builtinToolRegistry.resolve(invocation.toolId);
  if (!definition?.inputFiles) {
    return [];
  }
  return definition.inputFiles(invocation).map((input) => ({ ...input }));
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
  const execution = wrapWindowsCommandShim(executable, args);
  return {
    toolId,
    executable: execution.executable,
    args: execution.args,
    cwd,
    risk,
    displayCommand: [quoteDisplay(executable), ...args.map(quoteDisplay)].join(' '),
    shell: false,
  };
}

function wrapWindowsCommandShim(
  executable: string,
  args: string[],
): { executable: string; args: string[] } {
  if (process.platform !== 'win32' || !/\.cmd$/iu.test(executable)) {
    return { executable, args: [...args] };
  }
  // Quote the executable if it contains spaces so cmd.exe parses it correctly
  const quotedExecutable = executable.includes(' ') ? `"${executable}"` : executable;
  return {
    executable: process.env.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', quotedExecutable, ...args],
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
