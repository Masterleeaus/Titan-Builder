import path from 'node:path';
import { getActiveProject, resolveRegisteredProjectId, registerProject, type ProjectRegistryOptions, type ProjectRecord } from './registry.js';

export interface ResolvedProject {
  id: string;
  root: string;
  name: string;
  isActive: boolean;
  source: 'active' | 'current' | 'explicit' | 'registered';
}

interface ProjectResolverOptions extends ProjectRegistryOptions {
  fallbackToCurrentDir?: boolean;
  requireExplicit?: boolean;
}

export async function resolveProjectForOperation(
  options: ProjectResolverOptions = {},
): Promise<ResolvedProject> {
  const { fallbackToCurrentDir = true, requireExplicit = false } = options;

  const activeProject = await getActiveProject(options);
  if (activeProject) {
    return {
      id: activeProject.id,
      root: activeProject.root,
      name: activeProject.name,
      isActive: true,
      source: 'active',
    };
  }

  if (requireExplicit) {
    throw new Error(
      'No active project selected. ' +
      'Use `openbrowser project use <id>` to select a project, or provide an explicit project ID.',
    );
  }

  if (!fallbackToCurrentDir) {
    throw new Error('No active project and fallback to current directory is disabled.');
  }

  const currentDir = process.cwd();
  const registered = await registerProject(currentDir, options);

  return {
    id: registered.id,
    root: registered.root,
    name: registered.name,
    isActive: false,
    source: 'current',
  };
}

export async function resolveProjectExplicit(
  projectIdOrPath: string,
  options: ProjectResolverOptions = {},
): Promise<ResolvedProject> {
  if (!projectIdOrPath || projectIdOrPath.trim() === '') {
    throw new Error('Project identifier or path is required.');
  }

  const normalized = projectIdOrPath.trim();

  try {
    const registered = await resolveRegisteredProjectId(normalized, options);
    const isActive = (await getActiveProject(options))?.id === registered.id;
    return {
      id: registered.id,
      root: registered.root,
      name: registered.name,
      isActive,
      source: 'registered',
    };
  } catch {
    const resolved = await registerProject(normalized, options);
    const isActive = (await getActiveProject(options))?.id === resolved.id;
    return {
      id: resolved.id,
      root: resolved.root,
      name: resolved.name,
      isActive,
      source: 'explicit',
    };
  }
}

export async function assertProjectRootAuthority(
  declaredRoot: string,
  registryOptions: ProjectRegistryOptions = {},
): Promise<ResolvedProject> {
  const resolved = await resolveProjectForOperation({ ...registryOptions, fallbackToCurrentDir: false });
  const normalizedDeclared = path.resolve(declaredRoot);
  const normalizedResolved = path.resolve(resolved.root);

  if (normalizedDeclared !== normalizedResolved) {
    throw new Error(
      `Project root mismatch. ` +
      `Declared: ${normalizedDeclared}, ` +
      `Active/Current: ${normalizedResolved}. ` +
      `Cannot cross project boundaries.`,
    );
  }

  return resolved;
}

export type { ProjectRegistryOptions, ProjectRecord };
