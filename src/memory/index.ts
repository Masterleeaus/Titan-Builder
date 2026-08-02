import path from 'node:path';
import { openProjectInternalState } from '../security/internal-state.js';

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

export async function ensureMemory(projectRoot: string): Promise<void> {
  const state = await openProjectInternalState(projectRoot);
  await state.ensureJson(MEMORY_FILES.project, {});
  await state.ensureJson(MEMORY_FILES.history, []);
  await state.ensureJson(MEMORY_FILES.settings, { port: 5000 });
  await state.ensureJson(MEMORY_FILES.chat, []);
  await state.ensureJson(MEMORY_FILES.tasks, []);
}

export async function appendHistory(
  projectRoot: string,
  entry: HistoryEntry,
): Promise<void> {
  await ensureMemory(projectRoot);
  const state = await openProjectInternalState(projectRoot);
  const history = await state.readJson<HistoryEntry[]>(MEMORY_FILES.history);
  history.push(entry);
  await state.writeJson(MEMORY_FILES.history, history);
}

export async function listHistory(projectRoot: string): Promise<HistoryEntry[]> {
  await ensureMemory(projectRoot);
  const state = await openProjectInternalState(projectRoot);
  return structuredClone(await state.readJson<HistoryEntry[]>(MEMORY_FILES.history));
}

export async function saveContextSummary(
  projectRoot: string,
  summary: string,
): Promise<void> {
  await ensureMemory(projectRoot);
  const state = await openProjectInternalState(projectRoot);
  await state.writeText(MEMORY_FILES.contextSummary, summary);
}

export function promptFilePath(projectRoot: string, sessionId: string): string {
  return path.join(
    path.resolve(projectRoot),
    OPENBROWSER_DIR,
    promptRelativePath(sessionId),
  );
}

export async function writePromptFile(
  projectRoot: string,
  sessionId: string,
  content: string,
): Promise<string> {
  const state = await openProjectInternalState(projectRoot);
  const relativePath = promptRelativePath(sessionId);
  await state.writeText(relativePath, content);
  return path.join(state.stateRoot, relativePath);
}

export async function readPromptFile(
  projectRoot: string,
  sessionId: string,
): Promise<string> {
  const state = await openProjectInternalState(projectRoot);
  return state.readText(promptRelativePath(sessionId));
}

function promptRelativePath(sessionId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(sessionId)) {
    throw new Error('Prompt session ID must be a portable identifier');
  }
  return path.join(MEMORY_FILES.promptsDir, `${sessionId}.txt`);
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
