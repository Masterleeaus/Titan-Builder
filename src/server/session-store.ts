import crypto from 'node:crypto';
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

const sessions = new Map<string, PromptSession>();

export function createSession(input: CreateSessionInput): PromptSession {
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
  return session;
}

export function releaseClaim(
  sessionId: string,
  claimToken: string,
  nowMs = Date.now(),
): PromptSession | undefined {
  const session = requireClaim(sessionId, claimToken, nowMs);
  resetClaim(session, nowMs);
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
  const session = requireClaim(sessionId, claimToken, nowMs);
  session.partialText = partialText;
  session.lastActivityAt = new Date(nowMs).toISOString();
  return session;
}

export function completeSession(
  sessionId: string,
  response: string,
  claimToken: string,
  nowMs = Date.now(),
): PromptSession | undefined {
  const session = requireClaim(sessionId, claimToken, nowMs);
  session.status = 'complete';
  session.response = response;
  session.completedAt = new Date(nowMs).toISOString();
  session.lastActivityAt = session.completedAt;
  clearClaim(session);
  return session;
}

export function failSession(
  sessionId: string,
  error: string,
  claimToken: string,
  nowMs = Date.now(),
): PromptSession | undefined {
  const session = requireClaim(sessionId, claimToken, nowMs);
  session.status = 'error';
  session.error = error;
  session.completedAt = new Date(nowMs).toISOString();
  session.lastActivityAt = session.completedAt;
  clearClaim(session);
  return session;
}

export function clearSessions(): void {
  sessions.clear();
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
