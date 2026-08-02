import { loadOpenBrowserEnvironment } from '../config/environment.js';
import type { SessionMode } from '../server/session-store.js';
import { resolveResponseTimeouts } from './response-timeout.js';

loadOpenBrowserEnvironment();

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = Number(process.env.PORT ?? 5000);

export interface SubmitPromptInput {
  mode: SessionMode;
  prompt: string;
  systemPrompt: string;
  message: string;
  conversationId: string;
  markdownDraft?: boolean;
}

export interface SessionStatusResponse {
  sessionId: string;
  status: 'pending' | 'claimed' | 'complete' | 'error';
  mode: SessionMode;
  response?: string;
  partialText?: string;
  error?: string;
}

function baseUrl(port = DEFAULT_PORT): string {
  return `http://${DEFAULT_HOST}:${port}`;
}

function authHeaders(): Record<string, string> {
  const token = process.env.BRIDGE_TOKEN?.trim();
  if (!token || token.length < 32) {
    throw new Error(
      'A strong BRIDGE_TOKEN is required. Start OpenBrowser once to generate secure bridge credentials.',
    );
  }

  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  };
}

export async function submitPrompt(
  input: SubmitPromptInput,
  port = DEFAULT_PORT,
): Promise<{ sessionId: string }> {
  const response = await fetch(`${baseUrl(port)}/session/prompt`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit prompt (${response.status})`);
  }

  return (await response.json()) as { sessionId: string };
}

export async function getSessionStatus(
  sessionId: string,
  port = DEFAULT_PORT,
): Promise<SessionStatusResponse> {
  const response = await fetch(`${baseUrl(port)}/session/${sessionId}/status`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to read session status (${response.status})`);
  }

  return (await response.json()) as SessionStatusResponse;
}

export async function waitForSessionResponse(
  sessionId: string,
  options: {
    timeoutMs?: number;
    port?: number;
    onChunk?: (text: string) => void;
  } = {},
): Promise<string> {
  const configuredTimeouts = resolveResponseTimeouts(process.env);
  const timeoutMs = options.timeoutMs ?? configuredTimeouts.totalTimeoutMs;
  const idleTimeoutMs = Math.min(configuredTimeouts.idleTimeoutMs, timeoutMs);
  const port = options.port ?? DEFAULT_PORT;

  const existing = await getSessionStatus(sessionId, port);
  if (existing.status === 'complete' && existing.response !== undefined) {
    return existing.response;
  }
  if (existing.status === 'error') {
    throw new Error(existing.error ?? 'Browser session failed');
  }
  if (existing.partialText) {
    options.onChunk?.(existing.partialText);
  }

  return waitForSessionSse(sessionId, {
    totalTimeoutMs: timeoutMs,
    idleTimeoutMs,
    port,
    onChunk: options.onChunk,
  });
}

async function waitForSessionSse(
  sessionId: string,
  options: {
    totalTimeoutMs: number;
    idleTimeoutMs: number;
    port: number;
    onChunk?: (text: string) => void;
  },
): Promise<string> {
  const response = await fetch(`${baseUrl(options.port)}/session/${sessionId}/events`, {
    headers: authHeaders(),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to open session SSE stream (${response.status})`);
  }

  return new Promise<string>((resolve, reject) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let settled = false;
    let idleTimeout: ReturnType<typeof setTimeout>;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimeout);
      clearTimeout(totalTimeout);
      reader.cancel().catch(() => undefined);
      callback();
    };

    const resetIdleTimeout = (): void => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        finish(() => reject(new Error(
          `No bridge activity for ${Math.round(options.idleTimeoutMs / 1000)} seconds while waiting for browser AI.`,
        )));
      }, options.idleTimeoutMs);
    };

    const totalTimeout = setTimeout(() => {
      finish(() => reject(new Error(
        `Browser AI did not finish within ${Math.round(options.totalTimeoutMs / 60000)} minutes.`,
      )));
    }, options.totalTimeoutMs);

    resetIdleTimeout();

    const pump = (): void => {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            finish(() => reject(new Error('Session SSE stream closed before a response arrived')));
            return;
          }

          resetIdleTimeout();
          buffer += decoder.decode(value, { stream: true });
          buffer = consumeSseBuffer(buffer, (event, data) => {
            if (event === 'chunk') {
              options.onChunk?.(data.text as string);
              return;
            }
            if (event === 'complete') {
              finish(() => resolve(data.response as string));
              return;
            }
            if (event === 'error') {
              finish(() => reject(new Error((data.error as string) ?? 'Browser session failed')));
            }
          });

          pump();
        })
        .catch((error: unknown) => {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        });
    };

    pump();
  });
}

function consumeSseBuffer(
  buffer: string,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): string {
  const chunks = buffer.split('\n\n');
  const remainder = chunks.pop() ?? '';

  for (const chunk of chunks) {
    if (!chunk.trim() || chunk.startsWith(':')) {
      continue;
    }

    let event = 'message';
    let dataLine = '';

    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLine = line.slice(5).trim();
      }
    }

    if (!dataLine) {
      continue;
    }

    try {
      onEvent(event, JSON.parse(dataLine) as Record<string, unknown>);
    } catch {
      // Ignore malformed SSE payloads.
    }
  }

  return remainder;
}
