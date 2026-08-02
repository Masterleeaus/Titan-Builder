import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseToolManifest,
  type TitanToolManifest,
  type ToolRisk,
} from './manifest.js';
import {
  builtinToolRegistry,
  requiresExplicitApproval,
  type ToolId,
} from './catalog.js';
import type { ToolInputFile, ToolInvocation } from './types.js';
import { validateResolvedToolInvocation } from './validation.js';

const WORKTREE_SENSITIVE_GIT_TOOLS = new Set(['git.status', 'git.diff']);
const publicManifests = Object.freeze(
  builtinToolRegistry.manifests().map((manifest) => publicManifest(manifest)),
);
const publicManifestByRuntimeId = new Map(
  publicManifests.map((manifest) => [manifest.runtimeId, manifest]),
);

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
  const manifest = publicManifestByRuntimeId.get(definition.manifest.runtimeId);
  if (!manifest) {
    throw new Error(`Missing public manifest for tool: ${definition.manifest.runtimeId}`);
  }
  return validateResolvedToolInvocation(
    manifest,
    hardenGitInvocation(definition.resolve(args, projectRoot)),
  );
}

export function toolInputFiles(invocation: ToolInvocation): ToolInputFile[] {
  const definition = builtinToolRegistry.resolve(invocation.toolId);
  if (!definition?.inputFiles) {
    return [];
  }
  return definition.inputFiles(invocation).map((input) => ({ ...input }));
}

export function listToolManifests(): readonly TitanToolManifest[] {
  return publicManifests;
}

function publicManifest(manifest: TitanToolManifest): TitanToolManifest {
  if (!WORKTREE_SENSITIVE_GIT_TOOLS.has(manifest.runtimeId)) {
    return manifest;
  }

  return parseToolManifest({
    ...manifest,
    risk: 'ARBITRARY_EXECUTION',
    approval: 'explicit',
    securityConsiderations: [
      ...manifest.securityConsiderations,
      'Working-tree inspection can invoke repository-configured content filters.',
      'Explicit approval is required before worktree-sensitive Git reads execute.',
      'Execution is delegated to a self-sanitising Git runner that closes user, system, command-scope, pager, editor, credential, fsmonitor, hook, external-diff, and textconv helper paths.',
    ],
  });
}

function hardenGitInvocation(candidate: ToolInvocation): ToolInvocation {
  if (candidate.executable !== 'git') {
    return candidate;
  }

  const gitArgs = hardenedGitArgs(candidate.toolId, candidate.args);
  const modulePath = fileURLToPath(import.meta.url);
  const sourceRuntime = path.extname(modulePath) === '.ts';
  const runnerPath = path.resolve(
    path.dirname(modulePath),
    '..',
    'git',
    sourceRuntime ? 'hardened-cli.ts' : 'hardened-cli.js',
  );
  const runnerArgs = [
    ...(sourceRuntime ? ['--experimental-strip-types'] : []),
    runnerPath,
    ...gitArgs,
  ];

  return {
    ...candidate,
    executable: process.execPath,
    args: runnerArgs,
    risk: WORKTREE_SENSITIVE_GIT_TOOLS.has(candidate.toolId)
      ? 'ARBITRARY_EXECUTION'
      : candidate.risk,
    displayCommand: ['git', ...gitArgs.map(quoteDisplay)].join(' '),
    shell: false,
  };
}

function hardenedGitArgs(toolId: string, args: string[]): string[] {
  if (toolId === 'git.diff') {
    return [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      ...args.slice(1),
    ];
  }

  if (toolId === 'git.show' && !args.includes('--no-textconv')) {
    const insertionPoint = Math.max(args.indexOf('--no-ext-diff') + 1, 1);
    return [
      ...args.slice(0, insertionPoint),
      '--no-textconv',
      ...args.slice(insertionPoint),
    ];
  }

  return [...args];
}

function quoteDisplay(value: string): string {
  return /\s/u.test(value) ? JSON.stringify(value) : value;
}
