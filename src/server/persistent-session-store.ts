import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PromptSession } from './session-store.js';

export interface PersistentSessionStoreOptions {
  maxEntries?: number;
  maxTotalBytes?: number;
  maxFieldBytes?: number;
  completedRetentionMs?: number;
  errorRetentionMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB
const DEFAULT_MAX_FIELD_BYTES = 10 * 1024 * 1024; // 10 MB per field
const DEFAULT_COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_ERROR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSIONS_FILE = 'sessions.json';

export interface PersistentSessionStore {
  loadSessions(): Promise<PromptSession[]>;
  saveSessions(sessions: PromptSession[]): Promise<void>;
  validateFieldSize(field: string, value: string): boolean;
  validateTotalSize(sessions: PromptSession[]): boolean;
  pruneByPolicy(sessions: PromptSession[], nowMs?: number): PromptSession[];
  getStorageStats(sessions: PromptSession[]): {
    entryCount: number;
    totalBytes: number;
    byStatus: Record<string, number>;
  };
}

export function createPersistentSessionStore(
  projectRoot: string,
  options: PersistentSessionStoreOptions = {},
): PersistentSessionStore {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const maxTotalBytes = Math.max(1024, options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES);
  const maxFieldBytes = Math.max(1024, options.maxFieldBytes ?? DEFAULT_MAX_FIELD_BYTES);
  const completedRetentionMs = options.completedRetentionMs ?? DEFAULT_COMPLETED_RETENTION_MS;
  const errorRetentionMs = options.errorRetentionMs ?? DEFAULT_ERROR_RETENTION_MS;
  const now = options.now ?? Date.now;

  const sessionsPath = path.join(projectRoot, '.openbrowser', SESSIONS_FILE);

  async function ensureDirectory(): Promise<void> {
    await mkdir(path.dirname(sessionsPath), { recursive: true, mode: 0o700 });
  }

  return {
    async loadSessions(): Promise<PromptSession[]> {
      try {
        await ensureDirectory();
        const content = await readFile(sessionsPath, 'utf8');
        const parsed = JSON.parse(content) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isValidSession);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
        throw error;
      }
    },

    async saveSessions(sessions: PromptSession[]): Promise<void> {
      await ensureDirectory();
      const ordered = [...sessions].sort((a, b) => {
        const aTime = a.completedAt || a.lastActivityAt;
        const bTime = b.completedAt || b.lastActivityAt;
        return aTime.localeCompare(bTime);
      });
      const tempPath = `${sessionsPath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
      await rename(tempPath, sessionsPath);
    },

    validateFieldSize(_field: string, value: string): boolean {
      const bytes = Buffer.byteLength(value, 'utf8');
      if (bytes > maxFieldBytes) {
        return false;
      }
      return true;
    },

    validateTotalSize(sessions: PromptSession[]): boolean {
      let totalBytes = 0;
      for (const session of sessions) {
        totalBytes += calculateSessionBytes(session);
        if (totalBytes > maxTotalBytes) {
          return false;
        }
      }
      return true;
    },

    pruneByPolicy(sessions: PromptSession[], nowMs?: number): PromptSession[] {
      const currentTime = nowMs ?? now();
      let filtered = [...sessions];

      // Remove expired entries based on status
      filtered = filtered.filter((session) => {
        if (session.status === 'pending' || session.status === 'claimed') {
          return true; // Never prune in-progress sessions
        }

        const completedAtMs = session.completedAt
          ? Date.parse(session.completedAt)
          : Date.parse(session.createdAt);

        if (session.status === 'error') {
          return currentTime - completedAtMs <= errorRetentionMs;
        }
        if (session.status === 'complete') {
          return currentTime - completedAtMs <= completedRetentionMs;
        }
        return true;
      });

      // Prune by count (keep newest)
      if (filtered.length > maxEntries) {
        filtered = filtered
          .sort((a, b) => {
            const aTime = a.completedAt || a.lastActivityAt;
            const bTime = b.completedAt || b.lastActivityAt;
            return bTime.localeCompare(aTime);
          })
          .slice(0, maxEntries);
      }

      // Prune by total bytes (keep newest by time)
      let totalBytes = 0;
      const bytesOk: PromptSession[] = [];
      filtered.sort((a, b) => {
        const aTime = a.completedAt || a.lastActivityAt;
        const bTime = b.completedAt || b.lastActivityAt;
        return bTime.localeCompare(aTime);
      });

      for (const session of filtered) {
        const sessionBytes = calculateSessionBytes(session);
        if (totalBytes + sessionBytes <= maxTotalBytes) {
          totalBytes += sessionBytes;
          bytesOk.push(session);
        }
      }

      return bytesOk;
    },

    getStorageStats(sessions: PromptSession[]) {
      let totalBytes = 0;
      const byStatus: Record<string, number> = {};

      for (const session of sessions) {
        totalBytes += calculateSessionBytes(session);
        byStatus[session.status] = (byStatus[session.status] ?? 0) + 1;
      }

      return {
        entryCount: sessions.length,
        totalBytes,
        byStatus,
      };
    },
  };
}

function calculateSessionBytes(session: PromptSession): number {
  return Buffer.byteLength(JSON.stringify(session), 'utf8');
}

function isValidSession(value: unknown): value is PromptSession {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.mode === 'string' &&
    typeof obj.prompt === 'string' &&
    typeof obj.systemPrompt === 'string' &&
    typeof obj.message === 'string' &&
    typeof obj.composerMessage === 'string' &&
    typeof obj.status === 'string' &&
    typeof obj.createdAt === 'string' &&
    typeof obj.lastActivityAt === 'string' &&
    typeof obj.attemptCount === 'number'
  );
}
