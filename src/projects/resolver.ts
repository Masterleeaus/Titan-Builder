import { realpath } from 'node:fs/promises';
import { getActiveProject, registerProject, type ProjectRegistryOptions, type ProjectRecord } from './registry.js';

export interface ProjectResolutionOptions extends ProjectRegistryOptions {
  override?: string;
}

export async function resolveEffectiveProject(
  options: ProjectResolutionOptions = {},
): Promise<ProjectRecord> {
  if (options.override) {
    return await registerProject(options.override, options);
  }

  const active = await getActiveProject(options);
  if (active) {
    return active;
  }

  return await registerProject(process.cwd(), options);
}

export async function getEffectiveProjectRoot(options: ProjectResolutionOptions = {}): Promise<string> {
  const project = await resolveEffectiveProject(options);
  try {
    return await realpath(project.root);
  } catch {
    return project.root;
  }
}
