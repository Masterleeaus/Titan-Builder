import crypto from 'node:crypto';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { loadOpenBrowserEnvironment } from '../config/environment.js';
import { buildBudgetedContext, generateContext } from '../context/index.js';
import {
  addProjectMemory,
  clearProjectMemory,
  listProjectMemory,
  removeProjectMemory,
  writePromptFile,
  readPromptFile,
} from '../memory/index.js';
import { executeOperations, planOperations } from '../operations/index.js';
import { validateOperations } from '../protocol/index.js';
import { logger } from '../shared/index.js';
import { readProjectStatus } from '../project/status.js';
import {
  getActiveProject,
  listProjects,
  registerProject,
  setActiveProject,
} from '../projects/registry.js';
import {
  PROMPT_FILE_COMPOSER_NOTE,
  PROMPT_FILE_NAME,
  PROMPT_INJECTION_CHAR_LIMIT,
  shouldDeliverPromptAsFile,
} from '../shared/prompt-delivery.js';
import {
  addBrowserClient,
  broadcastBrowserJob,
  createSseStream,
  writeCorsPreflight,
  addSessionClient,
  notifySessionComplete,
  notifySessionChunk,
  notifySessionError,
  removeBrowserClient,
  removeSessionClient,
  sendSseEvent,
  startSessionHeartbeat,
} from './sse-hub.js';
import type { PromptSession } from './session-store.js';
import {
  completeSession,
  createSession,
  failSession,
  getSession,
  listDispatchableSessions,
  releaseClaim,
  renewSessionClaim,
  tryClaimSession,
  updateSessionPartial,
} from './session-store.js';
import { authorizeBridgeRequest, isAllowedBridgeOrigin } from './security.js';

loadOpenBrowserEnvironment();

const PORT = Number(process.env.PORT ?? 5000);

interface ServerOptions {
  port?: number;
  host?: string;
}

export async function createBridgeServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, isAllowedBridgeOrigin(origin));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.addHook('onSend', async (request, reply) => {
    if (request.headers.origin && isAllowedBridgeOrigin(request.headers.origin)) {
      reply.header('Access-Control-Allow-Private-Network', 'true');
    }
  });

  app.options('/browser/events', async (request, reply) => {
    assertAllowedOrigin(request.headers.origin);
    reply.hijack();
    writeCorsPreflight(reply.raw, request.headers.origin);
  });

  app.options('/browser/claim', async (request, reply) => {
    assertAllowedOrigin(request.headers.origin);
    reply.hijack();
    writeCorsPreflight(reply.raw, request.headers.origin);
  });

  app.options('/browser/pending', async (request, reply) => {
    assertAllowedOrigin(request.headers.origin);
    reply.hijack();
    writeCorsPreflight(reply.raw, request.headers.origin);
  });

  app.options('/browser/heartbeat', async (request, reply) => {
    assertAllowedOrigin(request.headers.origin);
    reply.hijack();
    writeCorsPreflight(reply.raw, request.headers.origin);
  });

  app.options('/browser/release', async (request, reply) => {
    assertAllowedOrigin(request.headers.origin);
    reply.hijack();
    writeCorsPreflight(reply.raw, request.headers.origin);
  });

  app.options('/browser/chunk', async (request, reply) => {
    assertAllowedOrigin(request.headers.origin);
    reply.hijack();
    writeCorsPreflight(reply.raw, request.headers.origin);
  });

  app.options('/browser/response', async (request, reply) => {
    assertAllowedOrigin(request.headers.origin);
    reply.hijack();
    writeCorsPreflight(reply.raw, request.headers.origin);
  });

  app.options('/browser/prompt-file/:sessionId', async (request, reply) => {
    assertAllowedOrigin(request.headers.origin);
    reply.hijack();
    writeCorsPreflight(reply.raw, request.headers.origin);
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!isAllowedBridgeOrigin(request.headers.origin)) {
      return reply.code(403).send({ error: 'Forbidden bridge origin' });
    }

    const url = request.url.split('?')[0] ?? request.url;
    if (request.method === 'OPTIONS' || url === '/health') {
      return;
    }

    if (
      !authorizeBridgeRequest({
        configuredToken: process.env.BRIDGE_TOKEN,
        authorization: request.headers.authorization,
      })
    ) {
      return reply.code(401).send({ error: 'Unauthorized bridge request' });
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/project/status', async () => {
    const [status, memory, registered] = await Promise.all([
      readProjectStatus(process.cwd()),
      listProjectMemory(process.cwd()),
      registerProject(process.cwd()),
    ]);
    return { ...status, registeredProjectId: registered.id, memoryCount: memory.length };
  });

  app.get('/projects', async () => ({
    projects: await listProjects(),
    activeProject: await getActiveProject(),
  }));

  app.post('/projects/register-current', async (request) => {
    const body = request.body as { name?: string } | undefined;
    const project = await registerProject(process.cwd(), { name: body?.name });
    await setActiveProject(project.id);
    return { project };
  });

  app.post('/projects/active', async (request) => {
    const body = request.body as { projectId?: string };
    if (!body.projectId) throw new Error('projectId is required');
    return { project: await setActiveProject(body.projectId) };
  });

  app.get('/project/memory', async () => ({
    entries: await listProjectMemory(process.cwd()),
  }));

  app.post('/project/memory', async (request) => {
    const body = request.body as { text?: string; tags?: string[] };
    if (!body.text?.trim()) throw new Error('text is required');
    return { entry: await addProjectMemory(process.cwd(), body.text, body.tags ?? []) };
  });

  app.delete('/project/memory/:memoryId', async (request) => {
    const { memoryId } = request.params as { memoryId: string };
    return { removed: await removeProjectMemory(process.cwd(), memoryId) };
  });

  app.post('/project/memory/clear', async () => {
    await clearProjectMemory(process.cwd());
    return { cleared: true };
  });

  app.post('/project/context/preview', async (request) => {
    const body = request.body as {
      refs?: string[];
      totalCharacters?: number;
      perFileCharacters?: number;
      maxFiles?: number;
    };
    const result = await buildBudgetedContext(process.cwd(), body.refs ?? ['.'], {
      totalCharacters: body.totalCharacters,
      perFileCharacters: body.perFileCharacters,
      maxFiles: body.maxFiles,
    });
    return {
      projectRoot: result.projectRoot,
      refs: result.refs,
      limitCharacters: result.limitCharacters,
      perFileCharacters: result.perFileCharacters,
      maxFiles: result.maxFiles,
      totalCharacters: result.totalCharacters,
      included: result.included.map(({ content: _content, ...item }) => item),
      excluded: result.excluded,
    };
  });

  app.get('/summary', async () => ({
    context: await generateContext(process.cwd()),
  }));

  app.post('/operations/preview', async (request) => {
    const operations = validateOperations((request.body as { operations?: unknown }).operations);
    return { operations: await planOperations(operations, process.cwd()) };
  });

  app.post('/operations/apply', async (request) => {
    const body = request.body as {
      operations?: unknown;
      conversationId?: string;
    };
    const operations = validateOperations(body.operations);
    return {
      operations: await executeOperations(operations, process.cwd(), {
        conversationId: body.conversationId,
      }),
    };
  });

  app.post('/session', async () => ({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }));

  app.post('/session/prompt', async (request) => {
    const body = request.body as {
      mode?: 'ask' | 'agent';
      prompt?: string;
      systemPrompt?: string;
      message?: string;
      conversationId?: string;
      markdownDraft?: boolean;
    };

    if (!body.mode || !body.prompt || !body.systemPrompt || !body.message || !body.conversationId) {
      throw new Error('mode, prompt, systemPrompt, message, and conversationId are required');
    }

    const delivery = shouldDeliverPromptAsFile(body.message) ? 'file' : 'text';
    const composerMessage =
      delivery === 'file' ? PROMPT_FILE_COMPOSER_NOTE : body.message;

    const session = createSession({
      mode: body.mode,
      prompt: body.prompt,
      systemPrompt: body.systemPrompt,
      message: body.message,
      composerMessage,
      delivery,
      conversationId: body.conversationId,
      markdownDraft: body.markdownDraft,
    });

    if (delivery === 'file') {
      await writePromptFile(process.cwd(), session.id, body.message);
      logger.info(
        { sessionId: session.id, chars: body.message.length },
        'Prompt saved as attachment file (exceeds injection limit)',
      );
    }

    logger.info({ sessionId: session.id, mode: session.mode, delivery }, 'Prompt session queued');

    broadcastBrowserJob(toBrowserJob(session));

    return { sessionId: session.id, status: session.status };
  });

  app.get('/session/:sessionId/status', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = getSession(sessionId);

    if (!session) {
      throw new Error('Session not found');
    }

    return {
      sessionId: session.id,
      status: session.status,
      mode: session.mode,
      response: session.response,
      partialText: session.partialText,
      error: session.error,
    };
  });

  app.get('/session/:sessionId/events', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = getSession(sessionId);

    if (!session) {
      throw new Error('Session not found');
    }

    reply.hijack();
    const raw = reply.raw;
    const origin = request.headers.origin;

    let heartbeat: ReturnType<typeof setInterval>;
    const client = createSseStream(raw, (closedClient) => {
      clearInterval(heartbeat);
      removeSessionClient(sessionId, closedClient);
    }, origin);

    if (session.status === 'complete') {
      sendSseEvent(raw, 'complete', { response: session.response });
      raw.end();
      return;
    }

    if (session.status === 'error') {
      sendSseEvent(raw, 'error', { error: session.error });
      raw.end();
      return;
    }

    addSessionClient(sessionId, client);
    heartbeat = startSessionHeartbeat(sessionId, client);

    if (session.partialText) {
      sendSseEvent(raw, 'chunk', { text: session.partialText });
    }
  });

  app.get('/browser/events', async (request, reply) => {
    reply.hijack();
    const raw = reply.raw;
    const origin = request.headers.origin;

    const client = createSseStream(raw, (closedClient) => {
      clearInterval(heartbeat);
      removeBrowserClient(closedClient);
    }, origin);

    addBrowserClient(client);
    const heartbeat = setInterval(() => {
      client.write(': heartbeat\n\n');
    }, 15_000);

    request.raw.on('close', () => clearInterval(heartbeat));
  });

  app.get('/browser/pending', async () => ({
    jobs: listDispatchableSessions().map(toBrowserJob),
  }));

  app.post('/browser/claim', async (request) => {
    const body = request.body as { sessionId?: string; claimantId?: string };
    if (!body.sessionId) {
      throw new Error('sessionId is required');
    }

    const claim = tryClaimSession(body.sessionId, {
      claimantId: body.claimantId,
    });
    if (!claim) {
      return { claimed: false };
    }

    return {
      claimed: true,
      claimToken: claim.claimToken,
      claimExpiresAt: claim.session.claimExpiresAt,
      job: toBrowserJob(claim.session),
    };
  });

  app.post('/browser/heartbeat', async (request) => {
    const body = request.body as { sessionId?: string; claimToken?: string };
    if (!body.sessionId || !body.claimToken) {
      throw new Error('sessionId and claimToken are required');
    }

    const session = renewSessionClaim(body.sessionId, body.claimToken);
    return {
      accepted: true,
      claimExpiresAt: session?.claimExpiresAt,
    };
  });

  app.post('/browser/release', async (request) => {
    const body = request.body as { sessionId?: string; claimToken?: string };
    if (!body.sessionId || !body.claimToken) {
      throw new Error('sessionId and claimToken are required');
    }

    releaseClaim(body.sessionId, body.claimToken);
    return { accepted: true, status: 'pending' };
  });

  app.get('/browser/prompt-file/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = getSession(sessionId);

    if (!session || session.delivery !== 'file') {
      throw new Error('Prompt file not found');
    }

    const content = await readPromptFile(process.cwd(), sessionId);
    return {
      fileName: PROMPT_FILE_NAME,
      content,
    };
  });

  app.post('/browser/chunk', async (request) => {
    const body = request.body as {
      sessionId?: string;
      claimToken?: string;
      text?: string;
    };

    if (!body.sessionId || !body.claimToken || body.text === undefined) {
      throw new Error('sessionId, claimToken, and text are required');
    }

    updateSessionPartial(body.sessionId, body.text, body.claimToken);
    notifySessionChunk(body.sessionId, { text: body.text });
    return { accepted: true };
  });

  app.post('/browser/response', async (request) => {
    const body = request.body as {
      sessionId?: string;
      claimToken?: string;
      text?: string;
      error?: string;
    };

    if (!body.sessionId || !body.claimToken) {
      throw new Error('sessionId and claimToken are required');
    }

    if (body.error) {
      failSession(body.sessionId, body.error, body.claimToken);
      notifySessionError(body.sessionId, { error: body.error });
      logger.warn({ sessionId: body.sessionId, error: body.error }, 'Browser session failed');
      return { accepted: true, status: 'error' };
    }

    if (!body.text) {
      throw new Error('text or error is required');
    }

    completeSession(body.sessionId, body.text, body.claimToken);
    notifySessionComplete(body.sessionId, { response: body.text });
    logger.info({ sessionId: body.sessionId }, 'Browser response received');

    return { accepted: true, status: 'complete' };
  });

  app.post('/browser/message', async (request) => {
    return {
      accepted: true,
      receivedAt: new Date().toISOString(),
      body: request.body,
    };
  });

  return app;
}

function toBrowserJob(session: PromptSession) {
  return {
    sessionId: session.id,
    mode: session.mode,
    message: session.composerMessage,
    promptBody: session.message,
    composerMessage: session.composerMessage,
    delivery: session.delivery,
    promptInjectionCharLimit: PROMPT_INJECTION_CHAR_LIMIT,
    promptFileComposerNote: PROMPT_FILE_COMPOSER_NOTE,
    promptFileName: session.delivery === 'file' ? PROMPT_FILE_NAME : undefined,
    systemPrompt: session.systemPrompt,
    conversationId: session.conversationId,
    markdownDraft: session.markdownDraft,
    attemptCount: session.attemptCount,
  };
}

export async function startServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = await createBridgeServer();
  const port = options.port ?? PORT;
  const host = options.host ?? '127.0.0.1';
  await app.listen({ port, host });
  logger.info({ port, host }, 'Bridge server listening');
  return app;
}

function assertAllowedOrigin(origin?: string): void {
  if (!isAllowedBridgeOrigin(origin)) {
    throw new Error('Forbidden bridge origin');
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  startServer().catch((err) => {
    logger.error(err, 'Failed to start bridge server');
    process.exit(1);
  });
}
