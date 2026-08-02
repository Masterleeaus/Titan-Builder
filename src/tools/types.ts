import type { TitanToolManifest, ToolRisk } from './manifest.js';

export interface ToolInputFile {
  path: string;
  required: boolean;
}

export interface ToolInvocation {
  toolId: string;
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  risk: ToolRisk;
  displayCommand: string;
  shell: false;
}

export interface BuiltinToolDefinition {
  manifest: TitanToolManifest;
  resolve(args: string[], projectRoot: string): ToolInvocation;
  inputFiles?(invocation: ToolInvocation): ToolInputFile[];
}

export interface ToolRegistry {
  list(): readonly BuiltinToolDefinition[];
  manifests(): readonly TitanToolManifest[];
  resolve(idOrAlias: string): BuiltinToolDefinition | undefined;
  canonicalId(idOrAlias: string): string | undefined;
}
