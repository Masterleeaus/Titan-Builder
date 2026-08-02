import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import fs from 'fs-extra';

export const OPENBROWSER_DIR = '.openbrowser';

export const MEMORY_FILES = {
  project: 'project.json',
  history: 'history.json',
  settings: 'settings.json',
  chat: 'chat.json',
  tasks: 'tasks.json',
  contextSummary: 'context-summary.md',
  promptsDir: 'prompts',
} as const;

export interface HistoryEntry {
  timestamp: string;
  conversationId?: string;
  mode: 'ask' | 'agent' | 'server';
  summary: string;
  status?: 'committed' | 'failed';
  transactionId?: string;
  operationCount?: number;
  failedOperation?: number;
  rollbackStatus?: 'not_required' | 'rolled_back' | 'rollback_failed';
  error?: string;
}

function memoryPath(projectRoot: string, fileName?: string): string {
  return path.join(projectRoot, OPENBROWSER_DIR, fileName ?? '');
}

async function validateMemoryRoot(projectRoot: string): Promise<string> {
  const memoryRoot = memoryPath(projectRoot);

  try {
    const stats = await lstat(memoryRoot);

    if (stats.isSymbolicLink()) {
      throw new Error(`.openbrowser is a symbolic link or junction, which is not allowed`);
    }

    if (!stats.isDirectory()) {
      throw new Error(`.openbrowser must be a directory`);
    }

    const canonical = await realpath(memoryRoot);
    if (!canonical.startsWith(path.resolve(projectRoot))) {
      throw new Error(`.openbrowser resolves outside the project root`);
    }

    return canonical;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return memoryRoot;
    }
    throw error;
  }
}

export async function ensureMemory(projectRoot: string): Promise<void> {
  await validateMemoryRoot(projectRoot);
  await fs.ensureDir(memoryPath(projectRoot), { mode: 0o700 });
  await Promise.all([
    ensureJson(projectRoot, MEMORY_FILES.project, {}),
    ensureJson(projectRoot, MEMORY_FILES.history, []),
    ensureJson(projectRoot, MEMORY_FILES.settings, { port: 5000 }),
    ensureJson(projectRoot, MEMORY_FILES.chat, []),
    ensureJson(projectRoot, MEMORY_FILES.tasks, []),
  ]);
}

export async function appendHistory(
  projectRoot: string,
  entry: HistoryEntry,
): Promise<void> {
  await ensureMemory(projectRoot);
  const historyFile = memoryPath(projectRoot, MEMORY_FILES.history);
  const history = (await fs.readJson(historyFile)) as HistoryEntry[];
  history.push(entry);
  await fs.writeJson(historyFile, history, { spaces: 2 });
}

export async function listHistory(projectRoot: string): Promise<HistoryEntry[]> {
  await ensureMemory(projectRoot);
  const history = (await fs.readJson(
    memoryPath(projectRoot, MEMORY_FILES.history),
  )) as HistoryEntry[];
  return structuredClone(history);
}

export async function saveContextSummary(
  projectRoot: string,
  summary: string,
): Promise<void> {
  await ensureMemory(projectRoot);
  await fs.writeFile(memoryPath(projectRoot, MEMORY_FILES.contextSummary), summary);
}

async function ensureJson(
  projectRoot: string,
  fileName: string,
  value: unknown,
): Promise<void> {
  const filePath = memoryPath(projectRoot, fileName);
  if (!(await fs.pathExists(filePath))) {
    await fs.writeJson(filePath, value, { spaces: 2, mode: 0o600 });
  }
}

export function promptFilePath(projectRoot: string, sessionId: string): string {
  return path.join(
    memoryPath(projectRoot, MEMORY_FILES.promptsDir),
    `${sessionId}.txt`,
  );
}

export async function writePromptFile(
  projectRoot: string,
  sessionId: string,
  content: string,
): Promise<string> {
  const filePath = promptFilePath(projectRoot, sessionId);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

export async function readPromptFile(
  projectRoot: string,
  sessionId: string,
): Promise<string> {
  return fs.readFile(promptFilePath(projectRoot, sessionId), 'utf8');
}

export {
  addProjectMemory,
  clearProjectMemory,
  formatProjectMemory,
  listProjectMemory,
  projectMemoryFilePath,
  removeProjectMemory,
  type ProjectMemoryEntry,
} from './project-memory.js';
