import crypto from 'node:crypto';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { ensureBridgeSecurityEnvironment } from '../config/bridge-security.js';
import { loadOpenBrowserEnvironment } from '../config/environment.js';
import { buildBudgetedContext, generateContext } from '../context/index.js';
import {
  addProjectMemory,
  clearProjectMemory,
  listProjectMemory,
  readPromptFile,
  removeProjectMemory,
  writePromptFile,
} from '../memory/index.js';
import { executePlannedOperations, planOperations } from '../operations/index.js';
import { readProjectStatus } from '../project/status.js';
import {
  getActiveProject,
  listProjects,
  registerProject,
  resolveRegisteredProjectId,
  setActiveProject,
  type ProjectRegistryOptions,
} from '../projects/registry.js';
import { validateOperations } from '../protocol/index.js';
import { canonicalizeProjectRoot } from '../security/project-path.js';
import {
  assertRepositoryApprovalPolicy,
  captureRepositoryIdentity,
  normalizeProtectedBranches,
  sameRepositoryIdentity,
  type RepositoryIdentity,
} from '../security/repository-identity.js';
import { logger } from '../shared/index.js';
import {
  PROMPT_FILE_COMPOSER_NOTE,
  PROMPT_FILE_NAME,
  PROMPT_INJECTION_CHAR_LIMIT,
  shouldDeliverPromptAsFile,
} from '../shared/prompt-delivery.js';
import {
  createBrowserRunCoordinator,
} from '../workflows/browser-run-coordinator.js';
import { createBrowserRunStore } from '../workflows/browser-run-store.js';
import type { AgentSubmissionRequest } from '../workflows/agent-preparation.js';
import { createBridgeIdentityProof } from './bridge-identity.js';
import {
  bridgeBodyLimit,
  createPayloadTooLargeResponse,
  isPayloadTooLargeError,
  SMALL_BODY_LIMIT_BYTES,
} from './body-limits.js';
import { registerBrowserWorkflowRoutes } from './browser-workflow-routes.js';
import {
  createOperationApprovalStore,
  type OperationApprovalInspection,
} from './operation-approvals.js';
import {
  createBridgeSecurityPolicy,
  parseAllowedExtensionOrigins,
  resolveBridgeRouteScope,
} from './security.js';
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
import {
  addBrowserClient,
  addSessionClient,
  broadcastBrowserJob,
  createSseStream,
  notifySessionComplete,
  notifySessionChunk,
  notifySessionError,
  removeBrowserClient,
  removeSessionClient,
  sendSseEvent,
  startSessionHeartbeat,
  writeCorsPreflight,
} from './sse-hub.js';

loadOpenBrowserEnvironment();

const PORT = Number(process.env.PORT ?? 5000);

export interface ServerOptions {
  port?: number;
  host?: string;
  projectRoot?: string;
  controlToken?: string;
  browserToken?: string;
  allowedExtensionOrigins?: string[];
  allowInsecureDev?: boolean;
  approvalTtlMs?: number;
  protectedBranches?: string[];
  projectRegistryOptions?: ProjectRegistryOptions;
  browserWorkflowSubmitAndWait?: (
    request: AgentSubmissionRequest,
    projectRoot: string,
  ) => Promise<string>;
}

export async function createBridgeServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: SMALL_BODY_LIMIT_BYTES });
  app.setErrorHandler((error, request, reply) => {
    if (isPayloadTooLargeError(error)) {
      return reply.code(413).send(createPayloadTooLargeResponse(request));
    }
    return reply.send(error);
  });
  const projectRoot = await canonicalizeProjectRoot(options.projectRoot ?? process.cwd());
  const protectedBranches = normalizeProtectedBranches(
    options.protectedBranches ?? process.env.OPENBROWSER_PROTECTED_BRANCHES,
  );
  const insecureDevelopment = options.allowInsecureDev ?? process.env.OPENBROWSER_INSECURE_DEV === '1';
  const controlToken = String(options.controlToken ?? process.env.BRIDGE_TOKEN ?? '').trim();
  const bridgeInstanceId = crypto.randomUUID();
  const securityPolicy = createBridgeSecurityPolicy({
    controlToken,
    browserToken: options.browserToken ?? process.env.BRIDGE_BROWSER_TOKEN,
    allowedExtensionOrigins:
      options.allowedExtensionOrigins ?? parseAllowedExtensionOrigins(process.env.BRIDGE_EXTENSION_ORIGINS),
    allowInsecureDev: insecureDevelopment,
  });
  const operationApprovals = createOperationApprovalStore({ ttlMs: options.approvalTtlMs });
  const browserRunStore = createBrowserRunStore({
    homeDir: options.projectRegistryOptions?.homeDir,
  });
  const browserCoordinator = createBrowserRunCoordinator({
    store: browserRunStore,
    resolveProject: (projectId) =>
      resolveRegisteredProjectId(projectId, options.projectRegistryOptions),
    submitAndWait:
      options.browserWorkflowSubmitAndWait ??
      ((request, selectedProjectRoot) =>
        queueBrowserWorkflowPromptAndWait(request, selectedProjectRoot)),
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, securityPolicy.isAllowedPreflightOrigin(origin));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.addHook('onSend', async (request, reply) => {
    if (request.headers.origin && securityPolicy.isAllowedPreflightOrigin(request.headers.origin)) {
      reply.header('Access-Control-Allow-Private-Network', 'true');
    }
  });

  for (const route of [
    '/browser/events',
    '/browser/claim',
    '/browser/pending',
    '/browser/heartbeat',
    '/browser/release',
    '/browser/chunk',
    '/browser/response',
    '/browser/prompt-file/:sessionId',
  ]) {
    app.options(route, async (request, reply) => {
      assertAllowedOrigin(securityPolicy, request.headers.origin);
      reply.hijack();
      writeCorsPreflight(reply.raw, request.headers.origin);
    });
  }

  app.addHook('preHandler', async (request, reply) => {
    const scope = resolveBridgeRouteScope(request.method, request.url);
    const origin = request.headers.origin;

    if (!securityPolicy.isAllowedPreflightOrigin(origin)) {
      return reply.code(403).send({ error: 'Forbidden bridge origin' });
    }

    if (!securityPolicy.authorize({
      scope,
      authorization: request.headers.authorization,
      origin,
    })) {
      return reply.code(401).send({ error: 'Unauthorized bridge request' });
    }
  });

  app.get('/bridge/identity', async (request, reply) => {
    if (!controlToken) {
      return reply.code(503).send({ error: 'Bridge identity is unavailable without a control token' });
    }

    const { nonce } = request.query as { nonce?: string };
    const address = request.raw.socket.localAddress;
    const port = request.raw.socket.localPort;
    if (!address || !port) {
      return reply.code(503).send({ error: 'Bridge socket identity is unavailable' });
    }

    try {
      return createBridgeIdentityProof(controlToken, String(nonce ?? ''), bridgeInstanceId, {
        address,
        port,
      });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Invalid bridge identity challenge',
      });
    }
  });

  app.get('/health', async () => ({
    status: 'ok',
    authentication: insecureDevelopment ? 'insecure-development' : 'required',
    extensionOrigins: securityPolicy.allowedExtensionOrigins(),
  }));

  await registerBrowserWorkflowRoutes(app, { coordinator: browserCoordinator });

  app.get('/project/status', async () => {
    const [status, memory, registered] = await Promise.all([
      readProjectStatus(projectRoot),
      listProjectMemory(projectRoot),
      registerProject(projectRoot, options.projectRegistryOptions),
    ]);
    return { ...status, registeredProjectId: registered.id, memoryCount: memory.length };
  });

  app.get('/projects', async () => ({
    projects: await listProjects(options.projectRegistryOptions),
    activeProject: await getActiveProject(options.projectRegistryOptions),
  }));

  app.post('/projects/register-current', bridgeBodyLimit('/projects/register-current'), async (request) => {
    const body = request.body as { name?: string } | undefined;
    const project = await registerProject(projectRoot, {
      ...options.projectRegistryOptions,
      name: body?.name,
    });
    await setActiveProject(project.id, options.projectRegistryOptions);
    return { project };
  });

  app.post('/projects/active', bridgeBodyLimit('/projects/active'), async (request) => {
    const body = request.body as { projectId?: string };
    if (!body.projectId) throw new Error('projectId is required');
    return { project: await setActiveProject(body.projectId, options.projectRegistryOptions) };
  });

  app.get('/project/memory', async () => ({
    entries: await listProjectMemory(projectRoot),
  }));

  app.post('/project/memory', bridgeBodyLimit('/project/memory'), async (request) => {
    const body = request.body as { text?: string; tags?: string[] };
    if (!body.text?.trim()) throw new Error('text is required');
    return { entry: await addProjectMemory(projectRoot, body.text, body.tags ?? []) };
  });

  app.delete('/project/memory/:memoryId', async (request) => {
    const { memoryId } = request.params as { memoryId: string };
    return { removed: await removeProjectMemory(projectRoot, memoryId) };
  });

  app.post('/project/memory/clear', bridgeBodyLimit('/project/memory/clear'), async () => {
    await clearProjectMemory(projectRoot);
    return { cleared: true };
  });

  app.post('/project/context/preview', bridgeBodyLimit('/project/context/preview'), async (request) => {
    const body = request.body as {
      refs?: string[];
      totalCharacters?: number;
      perFileCharacters?: number;
      maxFiles?: number;
    };
    const result = await buildBudgetedContext(projectRoot, body.refs ?? ['.'], {
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

  app.get('/summary', async () => ({ context: await generateContext(projectRoot) }));

  app.post('/operations/preview', bridgeBodyLimit('/operations/preview'), async (request, reply) => {
    const operations = validateOperations((request.body as { operations?: unknown }).operations);
    const identityBeforePlan = await captureRepositoryIdentity(projectRoot);
    const plans = await planOperations(operations, identityBeforePlan.projectRoot);
    const identityAfterPlan = await captureRepositoryIdentity(identityBeforePlan.projectRoot);
    if (!sameRepositoryIdentity(identityBeforePlan, identityAfterPlan)) {
      return reply.code(409).send({
        error: 'Operation preview is stale because repository identity changed during planning',
      });
    }

    try {
      assertRepositoryApprovalPolicy(identityAfterPlan, protectedBranches);
    } catch (error) {
      return reply.code(403).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      operations: plans,
      approval: operationApprovals.issue({
        projectRoot: identityAfterPlan.projectRoot,
        repositoryIdentity: identityAfterPlan,
        plans,
      }),
    };
  });

  app.post('/operations/apply', bridgeBodyLimit('/operations/apply'), async (request, reply) => {
    const body = request.body as { approvalToken?: string; conversationId?: string };
    if (!body.approvalToken) {
      return reply.code(400).send({ error: 'approvalToken is required' });
    }

    let identityBeforeInspect: RepositoryIdentity;
    try {
      identityBeforeInspect = await captureRepositoryIdentity(projectRoot);
    } catch (error) {
      return reply.code(409).send({
        error: `Operation approval is stale because repository identity could not be captured: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    let inspection: OperationApprovalInspection;
    try {
      inspection = operationApprovals.inspect(body.approvalToken, {
        projectRoot: identityBeforeInspect.projectRoot,
        repositoryIdentity: identityBeforeInspect,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid operation approval';
      if (/repository identity/i.test(message)) {
        operationApprovals.revoke(body.approvalToken);
        return reply.code(409).send({ error: message });
      }
      return reply.code(403).send({ error: message });
    }

    let identityBeforeConsume: RepositoryIdentity;
    try {
      identityBeforeConsume = await captureRepositoryIdentity(identityBeforeInspect.projectRoot);
    } catch (error) {
      operationApprovals.revoke(body.approvalToken);
      return reply.code(409).send({
        error: `Operation approval is stale because repository identity could not be revalidated: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    if (
      !sameRepositoryIdentity(identityBeforeInspect, identityBeforeConsume) ||
      !sameRepositoryIdentity(inspection.repositoryIdentity, identityBeforeConsume)
    ) {
      operationApprovals.revoke(body.approvalToken);
      return reply.code(409).send({
        error: 'Operation approval is stale because repository identity changed before consumption',
      });
    }

    let plans: Awaited<ReturnType<typeof planOperations>>;
    try {
      plans = operationApprovals.consume(body.approvalToken, {
        projectRoot: identityBeforeConsume.projectRoot,
        repositoryIdentity: identityBeforeConsume,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid operation approval';
      return reply.code(/repository identity/i.test(message) ? 409 : 403).send({ error: message });
    }

    return {
      operations: await executePlannedOperations(plans, identityBeforeConsume.projectRoot, {
        conversationId: body.conversationId,
      }),
    };
  });

  app.post('/session', bridgeBodyLimit('/session'), async () => ({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }));

  app.post('/session/prompt', bridgeBodyLimit('/session/prompt'), async (request) => {
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
    const session = await queuePromptSession(
      {
        mode: body.mode,
        prompt: body.prompt,
        systemPrompt: body.systemPrompt,
        message: body.message,
        conversationId: body.conversationId,
        markdownDraft: body.markdownDraft,
      },
      projectRoot,
    );
    return { sessionId: session.id, status: session.status };
  });

  app.get('/session/:sessionId/status', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = getSession(sessionId);
    if (!session) throw new Error('Session not found');
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
    if (!session) throw new Error('Session not found');

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
    if (session.partialText) sendSseEvent(raw, 'chunk', { text: session.partialText });
  });

  app.get('/browser/events', async (request, reply) => {
    reply.hijack();
    const raw = reply.raw;
    const origin = request.headers.origin;
    let heartbeat: ReturnType<typeof setInterval>;
    const client = createSseStream(raw, (closedClient) => {
      clearInterval(heartbeat);
      removeBrowserClient(closedClient);
    }, origin);
    addBrowserClient(client);
    heartbeat = setInterval(() => client.write(': heartbeat\n\n'), 15_000);
    request.raw.on('close', () => clearInterval(heartbeat));
  });

  app.get('/browser/pending', async () => ({
    jobs: listDispatchableSessions().map(toBrowserJob),
  }));

  app.post('/browser/claim', bridgeBodyLimit('/browser/claim'), async (request) => {
    const body = request.body as { sessionId?: string; claimantId?: string };
    if (!body.sessionId) throw new Error('sessionId is required');
    const claim = tryClaimSession(body.sessionId, { claimantId: body.claimantId });
    if (!claim) return { claimed: false };
    return {
      claimed: true,
      claimToken: claim.claimToken,
      claimExpiresAt: claim.session.claimExpiresAt,
      job: toBrowserJob(claim.session),
    };
  });

  app.post('/browser/heartbeat', bridgeBodyLimit('/browser/heartbeat'), async (request) => {
    const body = request.body as { sessionId?: string; claimToken?: string };
    if (!body.sessionId || !body.claimToken) {
      throw new Error('sessionId and claimToken are required');
    }
    const session = renewSessionClaim(body.sessionId, body.claimToken);
    return { accepted: true, claimExpiresAt: session?.claimExpiresAt };
  });

  app.post('/browser/release', bridgeBodyLimit('/browser/release'), async (request) => {
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
    if (!session || session.delivery !== 'file') throw new Error('Prompt file not found');
    return {
      fileName: PROMPT_FILE_NAME,
      content: await readPromptFile(projectRoot, sessionId),
    };
  });

  app.post('/browser/chunk', bridgeBodyLimit('/browser/chunk'), async (request) => {
    const body = request.body as { sessionId?: string; claimToken?: string; text?: string };
    if (!body.sessionId || !body.claimToken || body.text === undefined) {
      throw new Error('sessionId, claimToken, and text are required');
    }
    updateSessionPartial(body.sessionId, body.text, body.claimToken);
    notifySessionChunk(body.sessionId, { text: body.text });
    return { accepted: true };
  });

  app.post('/browser/response', async (request) => {
    const MAX_RESPONSE_BYTES = 16 * 1024 * 1024; // 16 MiB
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
      const errorSize = Buffer.byteLength(body.error, 'utf8');
      if (errorSize > MAX_RESPONSE_BYTES) {
        throw new Error(`Browser error message exceeds ${MAX_RESPONSE_BYTES} bytes`);
      }
      failSession(body.sessionId, body.error, body.claimToken);
      notifySessionError(body.sessionId, { error: body.error });
      logger.warn({ sessionId: body.sessionId, errorSize }, 'Browser session failed');
      return { accepted: true, status: 'error' };
    }
    if (!body.text) throw new Error('text or error is required');
    const textSize = Buffer.byteLength(body.text, 'utf8');
    if (textSize > MAX_RESPONSE_BYTES) {
      throw new Error(`Browser response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    completeSession(body.sessionId, body.text, body.claimToken);
    notifySessionComplete(body.sessionId, { response: body.text });
    logger.info({ sessionId: body.sessionId, responseSize: textSize }, 'Browser response received');
    return { accepted: true, status: 'complete' };
  });

  app.post('/browser/message', bridgeBodyLimit('/browser/message'), async (request) => ({
    accepted: true,
    receivedAt: new Date().toISOString(),
    body: request.body,
  }));

  return app;
}

async function queuePromptSession(
  request: Pick<
    AgentSubmissionRequest,
    'mode' | 'prompt' | 'systemPrompt' | 'message' | 'conversationId' | 'markdownDraft'
  >,
  projectRoot: string,
): Promise<PromptSession> {
  const delivery = shouldDeliverPromptAsFile(request.message) ? 'file' : 'text';
  const composerMessage = delivery === 'file' ? PROMPT_FILE_COMPOSER_NOTE : request.message;
  const session = createSession({
    mode: request.mode,
    prompt: request.prompt,
    systemPrompt: request.systemPrompt,
    message: request.message,
    composerMessage,
    delivery,
    conversationId: request.conversationId,
    markdownDraft: request.markdownDraft,
  });
  if (delivery === 'file') {
    await writePromptFile(projectRoot, session.id, request.message);
    logger.info(
      { sessionId: session.id, chars: request.message.length },
      'Prompt saved as attachment file (exceeds injection limit)',
    );
  }
  logger.info({ sessionId: session.id, mode: session.mode, delivery }, 'Prompt session queued');
  broadcastBrowserJob(toBrowserJob(session));
  return session;
}

async function queueBrowserWorkflowPromptAndWait(
  request: AgentSubmissionRequest,
  projectRoot: string,
): Promise<string> {
  const session = await queuePromptSession(request, projectRoot);
  const timeoutAt = Date.now() + 15 * 60 * 1000;
  while (Date.now() < timeoutAt) {
    const current = getSession(session.id);
    if (!current) throw new Error('Browser session disappeared');
    if (current.status === 'complete') return current.response ?? '';
    if (current.status === 'error') throw new Error(current.error ?? 'Browser session failed');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for browser response');
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
  let generatedSecurity: Awaited<ReturnType<typeof ensureBridgeSecurityEnvironment>> | undefined;
  if (
    options.controlToken === undefined &&
    options.browserToken === undefined &&
    options.allowInsecureDev !== true
  ) {
    generatedSecurity = await ensureBridgeSecurityEnvironment();
  }

  const app = await createBridgeServer(options);
  const port = options.port ?? PORT;
  const host = options.host ?? '127.0.0.1';
  await app.listen({ port, host });
  logger.info({
    port,
    host,
    generatedControlToken: generatedSecurity?.generatedControlToken ?? false,
    generatedBrowserToken: generatedSecurity?.generatedBrowserToken ?? false,
    securityConfigPath: generatedSecurity?.configPath,
  }, 'Bridge server listening');
  return app;
}

function assertAllowedOrigin(
  securityPolicy: ReturnType<typeof createBridgeSecurityPolicy>,
  origin?: string,
): void {
  if (!securityPolicy.isAllowedPreflightOrigin(origin)) {
    throw new Error('Forbidden bridge origin');
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  startServer().catch((error) => {
    logger.error(error, 'Failed to start bridge server');
    process.exit(1);
  });
}
