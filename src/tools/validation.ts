import path from 'node:path';
import type { TitanToolManifest } from './manifest.js';
import type { ToolInvocation } from './types.js';

const CONTROL_CHARACTERS = /\0|\r|\n/u;

export function validateResolvedToolInvocation(
  manifest: TitanToolManifest,
  candidate: ToolInvocation,
): ToolInvocation {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error(`Tool ${manifest.runtimeId} resolver must return an invocation object`);
  }
  if (candidate.toolId !== manifest.runtimeId) {
    throw new Error(
      `Tool resolver returned tool ID ${candidate.toolId} but manifest requires ${manifest.runtimeId}`,
    );
  }
  if (candidate.risk !== manifest.risk) {
    throw new Error(
      `Tool ${manifest.runtimeId} resolver returned risk ${candidate.risk} but manifest requires ${manifest.risk}`,
    );
  }
  if (candidate.shell !== false) {
    throw new Error(`Tool ${manifest.runtimeId} shell must be false`);
  }
  assertCommandField(candidate.executable, 'executable', manifest.runtimeId);
  assertCommandField(candidate.displayCommand, 'display command', manifest.runtimeId);
  if (!path.isAbsolute(candidate.cwd) || CONTROL_CHARACTERS.test(candidate.cwd)) {
    throw new Error(`Tool ${manifest.runtimeId} requires an absolute working directory`);
  }
  if (!Array.isArray(candidate.args)) {
    throw new Error(`Tool ${manifest.runtimeId} arguments must be an array`);
  }

  const args = candidate.args.map((argument, index) => {
    if (typeof argument !== 'string' || argument.length > 300 || CONTROL_CHARACTERS.test(argument)) {
      throw new Error(`Tool ${manifest.runtimeId} argument ${index} is invalid`);
    }
    return argument;
  });
  Object.freeze(args);

  return Object.freeze({
    toolId: candidate.toolId,
    executable: candidate.executable,
    args,
    cwd: candidate.cwd,
    risk: candidate.risk,
    displayCommand: candidate.displayCommand,
    shell: false,
  });
}

function assertCommandField(value: string, field: string, toolId: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || CONTROL_CHARACTERS.test(value)) {
    throw new Error(`Tool ${toolId} ${field} is invalid`);
  }
}
