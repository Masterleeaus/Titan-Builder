import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPersistentSessionStore } from './persistent-session-store.js';
import type { PromptSession } from './session-store.js';

describe('PersistentSessionStore', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'persistent-session-test-'));
  });

  afterEach(async () => {
    try {
      await rmdir(projectRoot, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should save and load sessions', async () => {
    const store = createPersistentSessionStore(projectRoot);

    const session: PromptSession = {
      id: 'test-1',
      mode: 'ask',
      prompt: 'test prompt',
      systemPrompt: 'system',
      message: 'test message',
      composerMessage: 'composer',
      delivery: 'text',
      conversationId: 'conv-1',
      status: 'pending',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      attemptCount: 0,
    };

    await store.saveSessions([session]);
    const loaded = await store.loadSessions();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('test-1');
    expect(loaded[0].status).toBe('pending');
  });

  it('should return empty array if file does not exist', async () => {
    const store = createPersistentSessionStore(projectRoot);
    const sessions = await store.loadSessions();
    expect(sessions).toEqual([]);
  });

  it('should validate field sizes', () => {
    const store = createPersistentSessionStore(projectRoot, {
      maxFieldBytes: 100,
    });

    expect(store.validateFieldSize('test', 'small')).toBe(true);
    expect(store.validateFieldSize('test', 'a'.repeat(101))).toBe(false);
  });

  it('should prune expired sessions', () => {
    const store = createPersistentSessionStore(projectRoot, {
      completedRetentionMs: 1000,
      errorRetentionMs: 2000,
    });

    const now = Date.now();
    const sessions: PromptSession[] = [
      {
        id: 'pending-1',
        mode: 'ask',
        prompt: 'test',
        systemPrompt: 'sys',
        message: 'msg',
        composerMessage: 'composer',
        delivery: 'text',
        conversationId: 'conv-1',
        status: 'pending',
        createdAt: new Date(now - 2000).toISOString(),
        lastActivityAt: new Date(now).toISOString(),
        attemptCount: 1,
      },
      {
        id: 'complete-1',
        mode: 'ask',
        prompt: 'test',
        systemPrompt: 'sys',
        message: 'msg',
        composerMessage: 'composer',
        delivery: 'text',
        conversationId: 'conv-1',
        status: 'complete',
        response: 'response',
        createdAt: new Date(now - 3000).toISOString(),
        completedAt: new Date(now - 2000).toISOString(),
        lastActivityAt: new Date(now - 2000).toISOString(),
        attemptCount: 1,
      },
      {
        id: 'complete-2',
        mode: 'ask',
        prompt: 'test',
        systemPrompt: 'sys',
        message: 'msg',
        composerMessage: 'composer',
        delivery: 'text',
        conversationId: 'conv-1',
        status: 'complete',
        response: 'response',
        createdAt: new Date(now - 100).toISOString(),
        completedAt: new Date(now - 100).toISOString(),
        lastActivityAt: new Date(now - 100).toISOString(),
        attemptCount: 1,
      },
    ];

    const pruned = store.pruneByPolicy(sessions, now);

    expect(pruned).toHaveLength(2); // pending-1 and complete-2
    expect(pruned.map((s) => s.id)).toContain('pending-1');
    expect(pruned.map((s) => s.id)).toContain('complete-2');
  });

  it('should prune by entry count', () => {
    const store = createPersistentSessionStore(projectRoot, {
      maxEntries: 2,
      completedRetentionMs: 24 * 60 * 60 * 1000,
    });

    const now = Date.now();
    const sessions: PromptSession[] = Array.from({ length: 5 }, (_, i) => ({
      id: `session-${i}`,
      mode: 'ask',
      prompt: 'test',
      systemPrompt: 'sys',
      message: 'msg',
      composerMessage: 'composer',
      delivery: 'text',
      conversationId: 'conv-1',
      status: 'complete' as const,
      response: 'response',
      createdAt: new Date(now - i * 1000).toISOString(),
      completedAt: new Date(now - i * 1000).toISOString(),
      lastActivityAt: new Date(now - i * 1000).toISOString(),
      attemptCount: 1,
    }));

    const pruned = store.pruneByPolicy(sessions, now);

    expect(pruned).toHaveLength(2); // Keep newest 2
  });

  it('should calculate storage stats', () => {
    const store = createPersistentSessionStore(projectRoot);

    const sessions: PromptSession[] = [
      {
        id: 'test-1',
        mode: 'ask',
        prompt: 'test',
        systemPrompt: 'sys',
        message: 'msg',
        composerMessage: 'composer',
        delivery: 'text',
        conversationId: 'conv-1',
        status: 'pending',
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        attemptCount: 1,
      },
      {
        id: 'test-2',
        mode: 'ask',
        prompt: 'test',
        systemPrompt: 'sys',
        message: 'msg',
        composerMessage: 'composer',
        delivery: 'text',
        conversationId: 'conv-1',
        status: 'complete',
        response: 'response',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        attemptCount: 1,
      },
    ];

    const stats = store.getStorageStats(sessions);

    expect(stats.entryCount).toBe(2);
    expect(stats.totalBytes).toBeGreaterThan(0);
    expect(stats.byStatus['pending']).toBe(1);
    expect(stats.byStatus['complete']).toBe(1);
  });

  it('should never prune pending or claimed sessions', () => {
    const store = createPersistentSessionStore(projectRoot, {
      completedRetentionMs: 0, // Prune immediately
    });

    const now = Date.now();
    const sessions: PromptSession[] = [
      {
        id: 'pending-old',
        mode: 'ask',
        prompt: 'test',
        systemPrompt: 'sys',
        message: 'msg',
        composerMessage: 'composer',
        delivery: 'text',
        conversationId: 'conv-1',
        status: 'pending',
        createdAt: new Date(now - 100000).toISOString(),
        lastActivityAt: new Date(now - 100000).toISOString(),
        attemptCount: 5,
      },
      {
        id: 'claimed-old',
        mode: 'ask',
        prompt: 'test',
        systemPrompt: 'sys',
        message: 'msg',
        composerMessage: 'composer',
        delivery: 'text',
        conversationId: 'conv-1',
        status: 'claimed',
        claimedAt: new Date(now - 100000).toISOString(),
        claimExpiresAt: new Date(now + 100000).toISOString(),
        claimToken: 'token',
        createdAt: new Date(now - 100000).toISOString(),
        lastActivityAt: new Date(now - 100000).toISOString(),
        attemptCount: 1,
      },
    ];

    const pruned = store.pruneByPolicy(sessions, now);

    expect(pruned).toHaveLength(2); // Both should survive
    expect(pruned.map((s) => s.status)).toContain('pending');
    expect(pruned.map((s) => s.status)).toContain('claimed');
  });
});
