import type { TitanToolManifest, ToolRisk } from './manifest.js';
import {
  builtinToolRegistry,
  requiresExplicitApproval,
  type ToolId,
} from './catalog.js';
import type { ToolInputFile, ToolInvocation } from './types.js';

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
  return definition.resolve(args, projectRoot);
}

export function toolInputFiles(invocation: ToolInvocation): ToolInputFile[] {
  const definition = builtinToolRegistry.resolve(invocation.toolId);
  if (!definition?.inputFiles) {
    return [];
  }
  return definition.inputFiles(invocation).map((input) => ({ ...input }));
}

export function listToolManifests(): readonly TitanToolManifest[] {
  return builtinToolRegistry.manifests();
}
