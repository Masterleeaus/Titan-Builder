import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

export interface ProjectMemoryEntry {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const MEMORY_FILE = 'memory.json';
const MAX_MEMORY_ENTRIES = 500;
const MEMORY_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export async function listProjectMemory(projectRoot: string): Promise<ProjectMemoryEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(memoryFilePath(projectRoot), 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMemoryEntry).map((entry) => ({ ...entry, tags: [...entry.tags] }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function addProjectMemory(
  projectRoot: string,
  text: string,
  tags: string[] = [],
): Promise<ProjectMemoryEntry> {
  const normalizedText = normalizeMemoryText(text);
  if (!normalizedText) throw new Error('Memory text is required.');
  const normalizedTags = normalizeTags(tags);
  const entries = await listProjectMemory(projectRoot);
  const identity = memoryIdentity(normalizedText);
  const now = new Date().toISOString();
  const existing = entries.find((entry) => memoryIdentity(entry.text) === identity);

  if (existing) {
    existing.tags = normalizeTags([...existing.tags, ...normalizedTags]);
    existing.updatedAt = now;
    await writeMemory(projectRoot, entries);
    return { ...existing, tags: [...existing.tags] };
  }

  const entry: ProjectMemoryEntry = {
    id: `memory-${identity.slice(0, 16)}`,
    text: normalizedText,
    tags: normalizedTags,
    createdAt: now,
    updatedAt: now,
  };
  entries.push(entry);
  await writeMemory(projectRoot, entries);
  return { ...entry, tags: [...entry.tags] };
}

export async function removeProjectMemory(projectRoot: string, memoryId: string): Promise<boolean> {
  const entries = await listProjectMemory(projectRoot);
  const next = entries.filter((entry) => entry.id !== memoryId);
  if (next.length === entries.length) return false;
  await writeMemory(projectRoot, next);
  return true;
}

export async function clearProjectMemory(projectRoot: string): Promise<void> {
  await writeMemory(projectRoot, []);
}

export function formatProjectMemory(entries: ProjectMemoryEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((entry) => {
    const tags = entry.tags.length ? ` [${entry.tags.join(', ')}]` : '';
    return `- ${entry.text}${tags}`;
  });
  return [
    '--- OpenBrowser Project Memory ---',
    'Treat these as explicit project constraints and prior decisions. Verify them against the repository when relevant.',
    ...lines,
    '--- End Project Memory ---',
  ].join('\n');
}

export function projectMemoryFilePath(projectRoot: string): string {
  return memoryFilePath(projectRoot);
}

async function writeMemory(projectRoot: string, entries: ProjectMemoryEntry[]): Promise<void> {
  const filePath = memoryFilePath(projectRoot);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  pruneMemory(entries);
  const ordered = [...entries].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(ordered, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, filePath);
}

function pruneMemory(entries: ProjectMemoryEntry[]): void {
  const now = Date.now();
  const cutoff = now - MEMORY_RETENTION_MS;

  let writeIdx = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryTime = new Date(entry.createdAt).getTime();

    if (entryTime >= cutoff) {
      if (writeIdx !== i) {
        entries[writeIdx] = entry;
      }
      writeIdx++;
    }
  }

  entries.length = writeIdx;

  if (entries.length > MAX_MEMORY_ENTRIES) {
    entries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    entries.length = MAX_MEMORY_ENTRIES;
  }
}

function memoryFilePath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), '.openbrowser', MEMORY_FILE);
}

function normalizeMemoryText(value: string): string {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, 2000);
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.flatMap((tag) => String(tag).split(',')).map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
    .sort()
    .slice(0, 20);
}

function memoryIdentity(text: string): string {
  return crypto.createHash('sha256').update(normalizeMemoryText(text).toLowerCase()).digest('hex');
}

function isMemoryEntry(value: unknown): value is ProjectMemoryEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.text === 'string' &&
    Array.isArray(item.tags) &&
    item.tags.every((tag) => typeof tag === 'string') &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  );
}
