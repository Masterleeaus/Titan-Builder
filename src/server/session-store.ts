import crypto from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PromptDelivery } from '../shared/prompt-delivery.js';

export type SessionMode = 'ask' | 'agent';

export type SessionStatus =
  | 'pending'
  | 'claimed'
  | 'complete'
  | 'error';

export interface PromptSession {
  id: string;
  mode: SessionMode;
  prompt: string;
  systemPrompt: string;
  message: string;
  composerMessage: string;
  delivery: PromptDelivery;
  conversationId: string;
  markdownDraft?: boolean;
  status: SessionStatus;
  response?: string;
  partialText?: string;
  error?: string;
  createdAt: string;
  claimedAt?: string;
  claimExpiresAt?: string;
  claimToken?: string;
  claimantId?: string;
  attemptCount: number;
  lastActivityAt: string;
  completedAt?: string;
}

export interface CreateSessionInput {
  mode: SessionMode;
  prompt: string;
  systemPrompt: string;
  message: string;
  composerMessage: string;
  delivery: PromptDelivery;
  conversationId: string;
  markdownDraft?: boolean;
}

export interface ClaimSessionInput {
  claimantId?: string;
  nowMs?: number;
  leaseMs?: number;
}

export interface SessionClaim {
  session: PromptSession;
  claimToken: string;
}

export const DEFAULT_CLAIM_LEASE_MS = 120_000;

const MAX_PROMPT_SIZE = 1_000_000;
const MAX_RESPONSE_SIZE = 5_000_000;
const MAX_ERROR_SIZE = 10_000;
const MAX_SESSION_SIZE = MAX_RESPONSE_SIZE + MAX_PROMPT_SIZE + MAX_ERROR_SIZE + 100_000;
const MAX_TOTAL_SESSIONS = 1000;
const MAX_TOTAL_BYTES = 100_000_000;
const PENDING_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const COMPLETED_SESSION_TTL_MS = 60 * 60 * 1000;

const sessions = new Map<string, PromptSession>();
let persistencePath: string | null = null;
let isLoading = false;
let isDirty = false;
let isFlushing = false;

export function createSession(input: CreateSessionInput): PromptSession {
  if (Buffer.byteLength(input.prompt, 'utf8') > MAX_PROMPT_SIZE) {
    throw new Error(`Prompt exceeds maximum size of ${MAX_PROMPT_SIZE} bytes`);
  }
  if (Buffer.byteLength(input.systemPrompt, 'utf8') > MAX_PROMPT_SIZE) {
    throw new Error(`System prompt exceeds maximum size of ${MAX_PROMPT_SIZE} bytes`);
  }

  pruneExpiredSessions(Date.now());
  pruneToFitLimits();

  const now = new Date().toISOString();
  const session: PromptSession = {
    id: crypto.randomUUID(),
    mode: input.mode,
    prompt: input.prompt,
    systemPrompt: input.systemPrompt,
    message: input.message,
    composerMessage: input.composerMessage,
    delivery: input.delivery,
    conversationId: input.conversationId,
    markdownDraft: input.markdownDraft,
    status: 'pending',
    attemptCount: 0,
    createdAt: now,
    lastActivityAt: now,
  };

  sessions.set(session.id, session);
  isDirty = true;
  return session;
}

export function claimPendingSession(input: ClaimSessionInput = {}): SessionClaim | null {
  const nowMs = input.nowMs ?? Date.now();
  releaseExpiredClaims(nowMs);

  for (const session of sessions.values()) {
    if (session.status !== 'pending') {
      continue;
    }
    return claimSession(session, input, nowMs);
  }

  return null;
}

export function tryClaimSession(
  sessionId: string,
  input: ClaimSessionInput = {},
): SessionClaim | null {
  const nowMs = input.nowMs ?? Date.now();
  releaseExpiredClaims(nowMs);

  const session = sessions.get(sessionId);
  if (!session || session.status !== 'pending') {
    return null;
  }

  return claimSession(session, input, nowMs);
}

export function listDispatchableSessions(nowMs = Date.now()): PromptSession[] {
  releaseExpiredClaims(nowMs);
  return [...sessions.values()].filter((session) => session.status === 'pending');
}

export function renewSessionClaim(
  sessionId: string,
  claimToken: string,
  input: { nowMs?: number; leaseMs?: number } = {},
): PromptSession | undefined {
  const nowMs = input.nowMs ?? Date.now();
  const session = requireClaim(sessionId, claimToken, nowMs);
  session.claimExpiresAt = new Date(nowMs + (input.leaseMs ?? DEFAULT_CLAIM_LEASE_MS)).toISOString();
  session.lastActivityAt = new Date(nowMs).toISOString();
  isDirty = true;
  return session;
}

export function releaseClaim(
  sessionId: string,
  claimToken: string,
  nowMs = Date.now(),
): PromptSession | undefined {
  const session = requireClaim(sessionId, claimToken, nowMs);
  resetClaim(session, nowMs);
  isDirty = true;
  return session;
}

export function getSession(sessionId: string): PromptSession | undefined {
  return sessions.get(sessionId);
}

export function updateSessionPartial(
  sessionId: string,
  partialText: string,
  claimToken: string,
  nowMs = Date.now(),
): PromptSession | undefined {
  if (Buffer.byteLength(partialText, 'utf8') > MAX_RESPONSE_SIZE) {
    throw new Error(`Partial text exceeds maximum size of ${MAX_RESPONSE_SIZE} bytes`);
  }

  const session = requireClaim(sessionId, claimToken, nowMs);
  session.partialText = partialText;
  session.lastActivityAt = new Date(nowMs).toISOString();
  isDirty = true;
  return session;
}

export async function flushSessionsToDisk(): Promise<void> {
  await saveSessionsToDisk();
}

export function completeSession(
  sessionId: string,
  response: string,
  claimToken: string,
  nowMs = Date.now(),
): PromptSession | undefined {
  if (Buffer.byteLength(response, 'utf8') > MAX_RESPONSE_SIZE) {
    throw new Error(`Response exceeds maximum size of ${MAX_RESPONSE_SIZE} bytes`);
  }

  const session = requireClaim(sessionId, claimToken, nowMs);
  session.status = 'complete';
  session.response = response;
  delete session.partialText;
  session.completedAt = new Date(nowMs).toISOString();
  session.lastActivityAt = session.completedAt;
  clearClaim(session);
  isDirty = true;
  return session;
}

export function failSession(
  sessionId: string,
  error: string,
  claimToken: string,
  nowMs = Date.now(),
): PromptSession | undefined {
  if (Buffer.byteLength(error, 'utf8') > MAX_ERROR_SIZE) {
    throw new Error(`Error message exceeds maximum size of ${MAX_ERROR_SIZE} bytes`);
  }

  const session = requireClaim(sessionId, claimToken, nowMs);
  session.status = 'error';
  session.error = error;
  delete session.partialText;
  session.completedAt = new Date(nowMs).toISOString();
  session.lastActivityAt = session.completedAt;
  clearClaim(session);
  isDirty = true;
  return session;
}

export function clearSessions(): void {
  sessions.clear();
  isDirty = true;
}

export async function initializeSessionStore(customPath?: string): Promise<void> {
  persistencePath = customPath ?? path.join(os.homedir(), '.openbrowser', 'sessions.json');
  await loadSessionsFromDisk();
}

async function loadSessionsFromDisk(): Promise<void> {
  if (!persistencePath || isLoading) return;
  isLoading = true;
  try {
    const content = await readFile(persistencePath, 'utf8').catch(() => null);
    if (content) {
      const data = JSON.parse(content);
      if (Array.isArray(data)) {
        sessions.clear();
        for (const session of data) {
          if (isValidSession(session)) {
            sessions.set(session.id, session);
          }
        }
      }
    }
  } catch {
    // Ignore load errors
  } finally {
    isLoading = false;
  }
}

async function saveSessionsToDisk(): Promise<void> {
  if (!persistencePath || isLoading || !isDirty || isFlushing) return;
  isFlushing = true;
  isDirty = false;
  try {
    await mkdir(path.dirname(persistencePath), { recursive: true });
    const data = [...sessions.values()];
    const tempPath = `${persistencePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    await rename(tempPath, persistencePath);
  } catch {
    isDirty = true;
  } finally {
    isFlushing = false;
  }
}

function isValidSession(obj: unknown): obj is PromptSession {
  return typeof obj === 'object' && obj !== null && 'id' in obj && 'status' in obj;
}

function calculateSessionSize(session: PromptSession): number {
  const str = JSON.stringify(session);
  return Buffer.byteLength(str, 'utf8');
}

function pruneExpiredSessions(nowMs: number): void {
  const entriesToDelete: string[] = [];

  for (const [id, session] of sessions.entries()) {
    if (session.status === 'pending' || session.status === 'claimed') {
      const createdAtMs = Date.parse(session.createdAt);
      if (nowMs - createdAtMs > PENDING_SESSION_TTL_MS) {
        entriesToDelete.push(id);
      }
    } else if (session.status === 'complete' || session.status === 'error') {
      const completedAtMs = session.completedAt ? Date.parse(session.completedAt) : Date.parse(session.createdAt);
      if (nowMs - completedAtMs > COMPLETED_SESSION_TTL_MS) {
        entriesToDelete.push(id);
      }
    }
  }

  for (const id of entriesToDelete) {
    sessions.delete(id);
    isDirty = true;
  }
}

function pruneToFitLimits(): void {
  if (sessions.size <= MAX_TOTAL_SESSIONS) {
    let totalBytes = 0;
    for (const session of sessions.values()) {
      totalBytes += calculateSessionSize(session);
    }
    if (totalBytes <= MAX_TOTAL_BYTES) {
      return;
    }
  }

  const sorted = [...sessions.values()].sort((a, b) => {
    const aTime = Date.parse(a.lastActivityAt);
    const bTime = Date.parse(b.lastActivityAt);
    return aTime - bTime;
  });

  while (sessions.size > MAX_TOTAL_SESSIONS) {
    const oldest = sorted.shift();
    if (oldest) {
      sessions.delete(oldest.id);
      isDirty = true;
    }
  }

  let totalBytes = 0;
  for (const session of sessions.values()) {
    totalBytes += calculateSessionSize(session);
  }

  while (totalBytes > MAX_TOTAL_BYTES && sessions.size > 1) {
    const oldest = sorted.shift();
    if (oldest) {
      const size = calculateSessionSize(oldest);
      sessions.delete(oldest.id);
      totalBytes -= size;
      isDirty = true;
    }
  }
}

function claimSession(
  session: PromptSession,
  input: ClaimSessionInput,
  nowMs: number,
): SessionClaim {
  const claimToken = crypto.randomUUID();
  session.status = 'claimed';
  session.claimedAt = new Date(nowMs).toISOString();
  session.claimExpiresAt = new Date(nowMs + (input.leaseMs ?? DEFAULT_CLAIM_LEASE_MS)).toISOString();
  session.claimToken = claimToken;
  session.claimantId = input.claimantId;
  session.attemptCount += 1;
  session.lastActivityAt = session.claimedAt;
  return { session, claimToken };
}

function releaseExpiredClaims(nowMs: number): void {
  for (const session of sessions.values()) {
    if (session.status !== 'claimed' || !session.claimExpiresAt) {
      continue;
    }

    if (Date.parse(session.claimExpiresAt) <= nowMs) {
      resetClaim(session, nowMs);
    }
  }
}

function resetClaim(session: PromptSession, nowMs: number): void {
  session.status = 'pending';
  session.lastActivityAt = new Date(nowMs).toISOString();
  clearClaim(session);
  isDirty = true;
}

function clearClaim(session: PromptSession): void {
  session.claimedAt = undefined;
  session.claimExpiresAt = undefined;
  session.claimToken = undefined;
  session.claimantId = undefined;
}

function requireClaim(
  sessionId: string,
  claimToken: string,
  nowMs: number,
): PromptSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  if (session.status !== 'claimed') {
    throw new Error(`Session is not claimed (status: ${session.status})`);
  }
  if (!claimToken || session.claimToken !== claimToken) {
    throw new Error('Invalid session claim token');
  }
  if (session.claimExpiresAt && Date.parse(session.claimExpiresAt) <= nowMs) {
    resetClaim(session, nowMs);
    throw new Error('Session claim expired');
  }
  return session;
}
