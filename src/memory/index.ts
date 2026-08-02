import path from 'node:path';
import {
  ensureOpenBrowserStateDirectory,
  readOpenBrowserStateFile,
  writeOpenBrowserStateFile,
} from '../security/internal-state.js';

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

export async function ensureMemory(projectRoot: string): Promise<void> {
  await ensureOpenBrowserStateDirectory(projectRoot);
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
  const history = JSON.parse(
    await readOpenBrowserStateFile(projectRoot, MEMORY_FILES.history),
  ) as HistoryEntry[];
  history.push(entry);
  await writeOpenBrowserStateFile(
    projectRoot,
    MEMORY_FILES.history,
    `${JSON.stringify(history, null, 2)}\n`,
  );
}

export async function listHistory(projectRoot: string): Promise<HistoryEntry[]> {
  await ensureMemory(projectRoot);
  const history = JSON.parse(
    await readOpenBrowserStateFile(projectRoot, MEMORY_FILES.history),
  ) as HistoryEntry[];
  return structuredClone(history);
}

export async function saveContextSummary(
  projectRoot: string,
  summary: string,
): Promise<void> {
  await ensureMemory(projectRoot);
  await writeOpenBrowserStateFile(projectRoot, MEMORY_FILES.contextSummary, summary);
}

async function ensureJson(
  projectRoot: string,
  fileName: string,
  value: unknown,
): Promise<void> {
  try {
    await readOpenBrowserStateFile(projectRoot, fileName);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await writeOpenBrowserStateFile(
      projectRoot,
      fileName,
      `${JSON.stringify(value, null, 2)}\n`,
    );
  }
}

export function promptFilePath(projectRoot: string, sessionId: string): string {
  assertSafeSessionId(sessionId);
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
  assertSafeSessionId(sessionId);
  return writeOpenBrowserStateFile(
    projectRoot,
    path.join(MEMORY_FILES.promptsDir, `${sessionId}.txt`),
    content,
  );
}

export async function readPromptFile(
  projectRoot: string,
  sessionId: string,
): Promise<string> {
  assertSafeSessionId(sessionId);
  return readOpenBrowserStateFile(
    projectRoot,
    path.join(MEMORY_FILES.promptsDir, `${sessionId}.txt`),
  );
}

function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(sessionId)) {
    throw new Error('Prompt session id contains unsafe path characters');
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
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
