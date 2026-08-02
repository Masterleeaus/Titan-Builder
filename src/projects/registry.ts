import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';

export interface ProjectRecord {
  id: string;
  name: string;
  root: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectRegistryDocument {
  version: 1;
  activeProjectId: string | null;
  projects: ProjectRecord[];
}

export interface ProjectRegistryOptions {
  homeDir?: string;
  name?: string;
}

const EMPTY_REGISTRY: ProjectRegistryDocument = {
  version: 1,
  activeProjectId: null,
  projects: [],
};

export async function listProjects(options: ProjectRegistryOptions = {}): Promise<ProjectRecord[]> {
  const registry = await readRegistry(options);
  return [...registry.projects].sort((left, right) =>
    left.name.localeCompare(right.name) || left.root.localeCompare(right.root),
  );
}

export async function registerProject(
  projectRoot: string,
  options: ProjectRegistryOptions = {},
): Promise<ProjectRecord> {
  const root = await canonicalRoot(projectRoot);
  const registry = await readRegistry(options);
  const now = new Date().toISOString();
  const existing = registry.projects.find((item) => samePath(item.root, root));
  const name = sanitizeProjectName(options.name || (await inferProjectName(root)) || path.basename(root));

  if (existing) {
    existing.name = name;
    existing.root = root;
    existing.updatedAt = now;
    await writeRegistry(registry, options);
    return { ...existing };
  }

  const record: ProjectRecord = {
    id: stableProjectId(root),
    name,
    root,
    createdAt: now,
    updatedAt: now,
  };
  registry.projects.push(record);
  registry.activeProjectId ??= record.id;
  await writeRegistry(registry, options);
  return { ...record };
}

export async function setActiveProject(
  projectId: string,
  options: ProjectRegistryOptions = {},
): Promise<ProjectRecord> {
  const registry = await readRegistry(options);
  const project = registry.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  registry.activeProjectId = project.id;
  project.updatedAt = new Date().toISOString();
  await writeRegistry(registry, options);
  return { ...project };
}

export async function getActiveProject(
  options: ProjectRegistryOptions = {},
): Promise<ProjectRecord | null> {
  const registry = await readRegistry(options);
  if (!registry.activeProjectId) {
    return null;
  }
  const project = registry.projects.find((item) => item.id === registry.activeProjectId);
  return project ? { ...project } : null;
}

export async function resolveProject(
  identifier: string,
  options: ProjectRegistryOptions = {},
): Promise<ProjectRecord> {
  const normalized = identifier.trim().toLowerCase();
  const projects = await listProjects(options);
  const exact = projects.find(
    (item) =>
      item.id.toLowerCase() === normalized ||
      item.name.toLowerCase() === normalized ||
      samePath(item.root, identifier),
  );
  if (!exact) {
    throw new Error(`Project not found: ${identifier}`);
  }
  return exact;
}

export async function removeProject(
  projectId: string,
  options: ProjectRegistryOptions = {},
): Promise<boolean> {
  const registry = await readRegistry(options);
  const next = registry.projects.filter((item) => item.id !== projectId);
  if (next.length === registry.projects.length) {
    return false;
  }
  registry.projects = next;
  if (registry.activeProjectId === projectId) {
    registry.activeProjectId = null;
  }
  await writeRegistry(registry, options);
  return true;
}

export function getProjectRegistryPath(options: ProjectRegistryOptions = {}): string {
  return path.join(options.homeDir || os.homedir(), '.openbrowser', 'projects.json');
}

async function readRegistry(options: ProjectRegistryOptions): Promise<ProjectRegistryDocument> {
  try {
    const parsed = JSON.parse(await readFile(getProjectRegistryPath(options), 'utf8')) as Partial<ProjectRegistryDocument>;
    return {
      version: 1,
      activeProjectId: typeof parsed.activeProjectId === 'string' ? parsed.activeProjectId : null,
      projects: Array.isArray(parsed.projects)
        ? parsed.projects.filter(isProjectRecord).map((item) => ({ ...item }))
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(EMPTY_REGISTRY);
    }
    throw error;
  }
}

async function writeRegistry(
  registry: ProjectRegistryDocument,
  options: ProjectRegistryOptions,
): Promise<void> {
  const filePath = getProjectRegistryPath(options);
  await mkdir(path.dirname(filePath), { recursive: true });
  const normalized: ProjectRegistryDocument = {
    version: 1,
    activeProjectId: registry.activeProjectId,
    projects: [...registry.projects].sort((left, right) => left.name.localeCompare(right.name)),
  };
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

async function canonicalRoot(input: string): Promise<string> {
  const resolved = path.resolve(input);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

async function inferProjectName(root: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { name?: unknown };
    return typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : null;
  } catch {
    return null;
  }
}

function sanitizeProjectName(value: string): string {
  const name = value.trim().replace(/[\r\n\t]+/gu, ' ').slice(0, 120);
  return name || 'Unnamed project';
}

function stableProjectId(root: string): string {
  return `project-${crypto.createHash('sha256').update(normalizePath(root)).digest('hex').slice(0, 16)}`;
}

function normalizePath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function isProjectRecord(value: unknown): value is ProjectRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['id', 'name', 'root', 'createdAt', 'updatedAt'].every((key) => typeof item[key] === 'string');
}
