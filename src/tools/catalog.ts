import path from 'node:path';
import { parseToolManifest, type TitanToolManifest, type ToolRisk } from './manifest.js';
import type {
  BuiltinToolDefinition,
  ToolInputFile,
  ToolInvocation,
  ToolRegistry,
} from './types.js';

const APPROVED_SCRIPT = /^(?:test|build|lint|typecheck|check|verify)(?::[A-Za-z0-9_-]+)*$/u;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9_./\\ -]+$/u;
const SAFE_GIT_REVISION = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;

interface DefinitionOptions {
  runtimeId: string;
  name: string;
  purpose: string;
  category: string;
  risk: ToolRisk;
  approval: 'none' | 'explicit' | 'policy';
  permissions: TitanToolManifest['permissions'];
  commands: string[];
  exampleArgs?: string[];
  aliases?: string[];
  dependencies?: string[];
  servicesUsed?: string[];
  responsibilities?: string[];
  securityConsiderations?: string[];
  failureHandling?: string[];
  validation?: string[];
  relatedTools?: string[];
  relatedAgents?: string[];
  relatedSkills?: string[];
  relatedWorkflows?: string[];
  resolver(args: string[], cwd: string): ToolInvocation;
  inputFiles?(invocation: ToolInvocation): ToolInputFile[];
}

function defineTool(options: DefinitionOptions): BuiltinToolDefinition {
  const manifest = parseToolManifest({
    schemaVersion: '1',
    id: `titan.tool.${options.runtimeId}`,
    runtimeId: options.runtimeId,
    aliases: options.aliases ?? [],
    name: options.name,
    purpose: options.purpose,
    category: options.category,
    responsibilities: options.responsibilities ?? [options.purpose],
    inputs: {
      type: 'object',
      properties: {
        args: {
          type: 'array',
          items: { type: 'string', maxLength: 300 },
          maxItems: 20,
        },
        path: { type: 'string', description: 'Optional project-relative working directory.' },
      },
      additionalProperties: false,
    },
    outputs: {
      type: 'object',
      properties: {
        exitCode: { type: 'integer' },
        stdout: { type: 'string' },
        stderr: { type: 'string' },
      },
      required: ['exitCode', 'stdout', 'stderr'],
      additionalProperties: false,
    },
    permissions: options.permissions,
    dependencies: options.dependencies ?? [],
    servicesUsed: options.servicesUsed ?? [],
    commands: options.commands,
    configuration: ['No tool-specific configuration is required.'],
    securityConsiderations: options.securityConsiderations ?? [
      'Arguments are validated before process creation.',
      'Execution uses a fixed executable with shell mode disabled.',
    ],
    failureHandling: options.failureHandling ?? [
      'Invalid arguments fail before execution.',
      'Non-zero process exits are returned through the existing operation failure path.',
    ],
    validation: options.validation ?? [
      'Manifest validation occurs during registry construction.',
      'Resolver behavior is covered by unit and integration tests.',
    ],
    tests: [
      'src/tools/registry.test.ts',
      'src/tools/catalog.test.ts',
      'src/operations/transaction.integration.test.ts',
    ],
    documentation: [
      'README.md',
      'docs/superpowers/specs/2026-08-02-tool-library-expansion-design.md',
    ],
    examples: [{
      title: `Run ${options.runtimeId}`,
      tool: options.runtimeId,
      args: options.exampleArgs ?? [],
    }],
    version: '1.0.0',
    status: 'stable',
    owner: 'Titan Builder',
    risk: options.risk,
    approval: options.approval,
    compatibility: {
      minTitanVersion: '0.5.0',
      node: '>=22',
      platforms: ['linux', 'windows', 'macos'],
    },
    knowledge: {
      summary: options.purpose,
      keywords: uniqueSlugs([options.category, ...options.runtimeId.split('.')]),
      relatedTools: options.relatedTools ?? [],
      relatedAgents: options.relatedAgents ?? ['Titan Builder coding agent'],
      relatedSkills: options.relatedSkills ?? ['repository inspection'],
      relatedWorkflows: options.relatedWorkflows ?? ['operation preview and apply'],
    },
  });

  return Object.freeze({
    manifest,
    resolve(args: string[], projectRoot: string): ToolInvocation {
      const normalizedArgs = args.map(validateArgument);
      return options.resolver(normalizedArgs, path.resolve(projectRoot));
    },
    inputFiles: options.inputFiles,
  });
}

function gitReadTool(
  options: Omit<DefinitionOptions, 'category' | 'risk' | 'approval' | 'permissions' | 'servicesUsed'>,
): BuiltinToolDefinition {
  return defineTool({
    ...options,
    category: 'git',
    risk: 'READ',
    approval: 'none',
    permissions: ['process.execute', 'git.read'],
    servicesUsed: ['git-runtime', 'workspace-manager'],
    relatedAgents: ['Titan Builder coding agent', 'Titan Builder review agent'],
    relatedSkills: ['repository inspection', 'git analysis'],
    relatedWorkflows: ['project discovery', 'operation preview and apply'],
  });
}

const BUILTIN_TOOL_DEFINITION_MAP = {
  'git.status': gitReadTool({
    runtimeId: 'git.status',
    name: 'Git Status',
    purpose: 'Read concise repository, branch, and working-tree status.',
    commands: ['git status --short --branch'],
    resolver: (_args, cwd) => {
      requireArgCount('git.status', _args, 0);
      return invocation('git.status', 'git', ['status', '--short', '--branch'], cwd, 'READ');
    },
  }),
  'git.diff': gitReadTool({
    runtimeId: 'git.diff',
    name: 'Git Diff',
    purpose: 'Read unstaged or staged repository changes without modifying the workspace.',
    commands: ['git diff', 'git diff --staged'],
    exampleArgs: ['--staged'],
    resolver: (args, cwd) => {
      if (args.length > 1 || (args[0] && args[0] !== '--staged')) {
        throw new Error('git.diff accepts no arguments or only --staged');
      }
      return invocation('git.diff', 'git', ['diff', ...args], cwd, 'READ');
    },
  }),
  'git.log': gitReadTool({
    runtimeId: 'git.log',
    name: 'Git Log',
    purpose: 'Read a bounded, decorated commit history.',
    commands: ['git log --oneline --decorate -n <count>'],
    exampleArgs: ['20'],
    resolver: (args, cwd) => {
      if (args.length > 1) {
        throw new Error('git.log accepts at most one numeric count argument');
      }
      const count = args[0] ?? '20';
      if (!/^\d+$/u.test(count) || Number(count) < 1 || Number(count) > 100) {
        throw new Error('git.log count must be an integer between 1 and 100');
      }
      return invocation('git.log', 'git', ['log', '--oneline', '--decorate', '-n', count], cwd, 'READ');
    },
  }),
  'git.branch.current': gitReadTool({
    runtimeId: 'git.branch.current',
    name: 'Current Git Branch',
    purpose: 'Read the current Git branch name.',
    commands: ['git rev-parse --abbrev-ref HEAD'],
    resolver: (args, cwd) => {
      requireArgCount('git.branch.current', args, 0);
      return invocation('git.branch.current', 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 'READ');
    },
  }),
  'git.root': gitReadTool({
    runtimeId: 'git.root',
    name: 'Git Repository Root',
    purpose: 'Resolve the top-level directory of the current Git repository.',
    commands: ['git rev-parse --show-toplevel'],
    resolver: (args, cwd) => {
      requireArgCount('git.root', args, 0);
      return invocation('git.root', 'git', ['rev-parse', '--show-toplevel'], cwd, 'READ');
    },
  }),
  'git.branch.list': gitReadTool({
    runtimeId: 'git.branch.list',
    name: 'Git Branch List',
    purpose: 'List local or local-and-remote Git branch names using a fixed output format.',
    commands: [
      'git branch --format=%(refname:short)',
      'git branch --all --format=%(refname:short)',
    ],
    exampleArgs: ['--all'],
    resolver: (args, cwd) => {
      if (args.length > 1 || (args[0] && args[0] !== '--all')) {
        throw new Error('git.branch.list accepts no arguments or only --all');
      }
      return invocation(
        'git.branch.list',
        'git',
        ['branch', ...(args[0] === '--all' ? ['--all'] : []), '--format=%(refname:short)'],
        cwd,
        'READ',
      );
    },
  }),
  'git.remote.list': gitReadTool({
    runtimeId: 'git.remote.list',
    name: 'Git Remote List',
    purpose: 'List configured Git remote names without exposing remote URLs or embedded credentials.',
    commands: ['git remote'],
    securityConsiderations: [
      'The command intentionally omits -v so remote URLs and embedded credentials are not returned.',
      'No arguments are accepted and shell mode is disabled.',
    ],
    resolver: (args, cwd) => {
      requireArgCount('git.remote.list', args, 0);
      return invocation('git.remote.list', 'git', ['remote'], cwd, 'READ');
    },
  }),
  'git.show': gitReadTool({
    runtimeId: 'git.show',
    name: 'Git Object Summary',
    purpose: 'Inspect a constrained commit or ref summary without accepting paths or revision expressions.',
    commands: ['git show --no-ext-diff --stat --oneline --decorate --no-renames <revision> --'],
    exampleArgs: ['HEAD'],
    securityConsiderations: [
      'The revision grammar rejects option prefixes, ranges, reflogs, ancestry operators, pathspec syntax, whitespace, and backslashes.',
      'A final -- terminates revision and path parsing.',
      'Execution uses git directly with shell mode disabled.',
    ],
    resolver: (args, cwd) => {
      if (args.length !== 1) {
        throw new Error('git.show requires exactly one revision');
      }
      const revision = args[0] ?? '';
      if (!isSafeGitRevision(revision)) {
        throw new Error('git.show requires a safe Git revision');
      }
      return invocation(
        'git.show',
        'git',
        ['show', '--no-ext-diff', '--stat', '--oneline', '--decorate', '--no-renames', revision, '--'],
        cwd,
        'READ',
      );
    },
  }),
  'npm.install': defineTool({
    runtimeId: 'npm.install',
    name: 'npm Frozen Install',
    purpose: 'Install npm dependencies from the lockfile with lifecycle scripts disabled.',
    category: 'build',
    risk: 'NETWORK_WRITE',
    approval: 'explicit',
    permissions: ['filesystem.read', 'filesystem.write', 'process.execute', 'network.read', 'network.write'],
    servicesUsed: ['build-runtime', 'workspace-manager'],
    commands: ['npm ci --ignore-scripts'],
    securityConsiderations: [
      'Lifecycle scripts are disabled.',
      'package.json and package-lock.json are locked as approved inputs before execution.',
      'Explicit approval is required for network and filesystem changes.',
    ],
    resolver: (args, cwd) => {
      requireArgCount('npm.install', args, 0);
      return invocation('npm.install', platformCommand('npm'), ['ci', '--ignore-scripts'], cwd, 'NETWORK_WRITE');
    },
    inputFiles: () => [
      { path: 'package.json', required: true },
      { path: 'package-lock.json', required: true },
      { path: '.npmrc', required: false },
    ],
  }),
  'npm.test': defineTool({
    runtimeId: 'npm.test',
    name: 'npm Test',
    purpose: 'Run the repository npm test script through the approved operation path.',
    category: 'testing',
    risk: 'ARBITRARY_EXECUTION',
    approval: 'explicit',
    permissions: ['filesystem.read', 'process.execute'],
    servicesUsed: ['testing-runtime', 'workspace-manager'],
    commands: ['npm test'],
    resolver: (args, cwd) => {
      requireArgCount('npm.test', args, 0);
      return invocation('npm.test', platformCommand('npm'), ['test'], cwd, 'ARBITRARY_EXECUTION');
    },
    inputFiles: packageScriptInputs('npm'),
  }),
  'npm.run': defineTool({
    runtimeId: 'npm.run',
    name: 'npm Verification Script',
    purpose: 'Run one allow-listed npm verification script.',
    category: 'build',
    risk: 'ARBITRARY_EXECUTION',
    approval: 'explicit',
    permissions: ['filesystem.read', 'process.execute'],
    servicesUsed: ['build-runtime', 'testing-runtime', 'workspace-manager'],
    commands: ['npm run <approved-script>'],
    exampleArgs: ['verify'],
    resolver: (args, cwd) => runScriptInvocation('npm.run', platformCommand('npm'), args, cwd),
    inputFiles: packageScriptInputs('npm'),
  }),
  'pnpm.install': defineTool({
    runtimeId: 'pnpm.install',
    name: 'pnpm Frozen Install',
    purpose: 'Install pnpm dependencies from the frozen lockfile with lifecycle scripts disabled.',
    category: 'build',
    risk: 'NETWORK_WRITE',
    approval: 'explicit',
    permissions: ['filesystem.read', 'filesystem.write', 'process.execute', 'network.read', 'network.write'],
    servicesUsed: ['build-runtime', 'workspace-manager'],
    commands: ['pnpm install --frozen-lockfile --ignore-scripts'],
    securityConsiderations: [
      'Lifecycle scripts are disabled.',
      'package.json and pnpm-lock.yaml are locked as approved inputs before execution.',
      'Explicit approval is required for network and filesystem changes.',
    ],
    resolver: (args, cwd) => {
      requireArgCount('pnpm.install', args, 0);
      return invocation(
        'pnpm.install',
        platformCommand('pnpm'),
        ['install', '--frozen-lockfile', '--ignore-scripts'],
        cwd,
        'NETWORK_WRITE',
      );
    },
    inputFiles: () => [
      { path: 'package.json', required: true },
      { path: 'pnpm-lock.yaml', required: true },
      { path: 'pnpm-workspace.yaml', required: false },
      { path: '.npmrc', required: false },
    ],
  }),
  'pnpm.test': defineTool({
    runtimeId: 'pnpm.test',
    name: 'pnpm Test',
    purpose: 'Run the repository pnpm test script through the approved operation path.',
    category: 'testing',
    risk: 'ARBITRARY_EXECUTION',
    approval: 'explicit',
    permissions: ['filesystem.read', 'process.execute'],
    servicesUsed: ['testing-runtime', 'workspace-manager'],
    commands: ['pnpm test'],
    resolver: (args, cwd) => {
      requireArgCount('pnpm.test', args, 0);
      return invocation('pnpm.test', platformCommand('pnpm'), ['test'], cwd, 'ARBITRARY_EXECUTION');
    },
    inputFiles: packageScriptInputs('pnpm'),
  }),
  'pnpm.run': defineTool({
    runtimeId: 'pnpm.run',
    name: 'pnpm Verification Script',
    purpose: 'Run one allow-listed pnpm verification script.',
    category: 'build',
    risk: 'ARBITRARY_EXECUTION',
    approval: 'explicit',
    permissions: ['filesystem.read', 'process.execute'],
    servicesUsed: ['build-runtime', 'testing-runtime', 'workspace-manager'],
    commands: ['pnpm run <approved-script>'],
    exampleArgs: ['verify'],
    resolver: (args, cwd) => runScriptInvocation('pnpm.run', platformCommand('pnpm'), args, cwd),
    inputFiles: packageScriptInputs('pnpm'),
  }),
  'node.version': defineTool({
    runtimeId: 'node.version',
    name: 'Node.js Version',
    purpose: 'Read the active Node.js runtime version.',
    category: 'build',
    risk: 'READ',
    approval: 'none',
    permissions: ['process.execute'],
    servicesUsed: ['build-runtime'],
    commands: ['node --version'],
    resolver: (args, cwd) => {
      requireArgCount('node.version', args, 0);
      return invocation('node.version', process.execPath, ['--version'], cwd, 'READ');
    },
  }),
  'vscode.open': defineTool({
    runtimeId: 'vscode.open',
    name: 'Open in VS Code',
    purpose: 'Open the project or one contained project-relative path in Visual Studio Code.',
    category: 'workspace',
    risk: 'SAFE_EXECUTION',
    approval: 'none',
    permissions: ['filesystem.read', 'process.execute'],
    servicesUsed: ['workspace-manager'],
    commands: ['code <contained-relative-path>'],
    exampleArgs: ['src'],
    securityConsiderations: [
      'Absolute paths and path traversal are rejected.',
      'The target remains relative to the approved project root.',
      'Execution uses the VS Code CLI with shell mode disabled.',
    ],
    resolver: (args, cwd) => {
      if (args.length > 1) {
        throw new Error('vscode.open accepts at most one project-relative path');
      }
      const target = args[0] ?? '.';
      if (!SAFE_RELATIVE_PATH.test(target) || path.isAbsolute(target) || target.split(/[\\/]/u).includes('..')) {
        throw new Error('vscode.open path must stay inside the project root');
      }
      return invocation('vscode.open', platformCommand('code'), [target], cwd, 'SAFE_EXECUTION');
    },
  }),
} as const;

export type ToolId = keyof typeof BUILTIN_TOOL_DEFINITION_MAP;

export function createToolRegistry(input: readonly BuiltinToolDefinition[]): ToolRegistry {
  const definitions = [...input].sort((left, right) =>
    left.manifest.runtimeId.localeCompare(right.manifest.runtimeId));
  const byId = new Map<string, BuiltinToolDefinition>();
  const aliases = new Map<string, string>();

  for (const definition of definitions) {
    const runtimeId = definition.manifest.runtimeId;
    if (byId.has(runtimeId)) {
      throw new Error(`Duplicate tool runtime ID: ${runtimeId}`);
    }
    if (aliases.has(runtimeId)) {
      throw new Error(`Tool runtime ID collides with alias: ${runtimeId}`);
    }
    byId.set(runtimeId, definition);

    for (const alias of definition.manifest.aliases ?? []) {
      if (byId.has(alias)) {
        throw new Error(`Tool alias ${alias} collides with a runtime ID.`);
      }
      const existing = aliases.get(alias);
      if (existing) {
        throw new Error(`Duplicate tool alias ${alias}: ${existing} and ${runtimeId}`);
      }
      aliases.set(alias, runtimeId);
    }
  }

  const frozenDefinitions = Object.freeze(definitions);
  const frozenManifests = Object.freeze(definitions.map((definition) => definition.manifest));
  return Object.freeze({
    list: () => frozenDefinitions,
    manifests: () => frozenManifests,
    resolve(idOrAlias: string) {
      const canonical = byId.has(idOrAlias) ? idOrAlias : aliases.get(idOrAlias);
      return canonical ? byId.get(canonical) : undefined;
    },
    canonicalId(idOrAlias: string) {
      if (byId.has(idOrAlias)) {
        return idOrAlias;
      }
      return aliases.get(idOrAlias);
    },
  });
}

export const builtinToolRegistry = createToolRegistry(Object.values(BUILTIN_TOOL_DEFINITION_MAP));

export function isToolId(value: string): value is ToolId {
  return Object.hasOwn(BUILTIN_TOOL_DEFINITION_MAP, value);
}

export function requiresExplicitApproval(risk: ToolRisk): boolean {
  return risk === 'NETWORK_WRITE'
    || risk === 'ARBITRARY_EXECUTION'
    || risk === 'DESTRUCTIVE'
    || risk === 'PUBLISH';
}

function packageScriptInputs(manager: 'npm' | 'pnpm'): () => ToolInputFile[] {
  return () => manager === 'npm'
    ? [
      { path: 'package.json', required: true },
      { path: 'package-lock.json', required: false },
      { path: '.npmrc', required: false },
    ]
    : [
      { path: 'package.json', required: true },
      { path: 'pnpm-lock.yaml', required: false },
      { path: 'pnpm-workspace.yaml', required: false },
      { path: '.npmrc', required: false },
    ];
}

function runScriptInvocation(
  toolId: string,
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
  toolId: string,
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
  return {
    executable: process.env.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', executable, ...args],
  };
}

function validateArgument(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('Tool arguments must be strings');
  }
  if (value.length > 300) {
    throw new Error('Tool argument exceeds 300 characters');
  }
  if (/\0|\r|\n/u.test(value)) {
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
  return /\s/u.test(value) ? JSON.stringify(value) : value;
}

function isSafeGitRevision(value: string): boolean {
  return SAFE_GIT_REVISION.test(value)
    && !value.includes('..')
    && !value.includes('@{')
    && !/[~^:\\]/u.test(value);
}

function uniqueSlugs(values: string[]): string[] {
  return [...new Set(values
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, ''))
    .filter(Boolean))];
}
