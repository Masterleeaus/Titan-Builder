import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AgentApplicationError,
} from '../workflows/agent-application.js';
import type {
  BrowserRunCoordinator,
} from '../workflows/browser-run-coordinator.js';
import type {
  BrowserProvider,
  BrowserRunMode,
  VerificationProfile,
} from '../workflows/browser-run-types.js';

export interface BrowserWorkflowRouteDependencies {
  coordinator: BrowserRunCoordinator;
}

export async function registerBrowserWorkflowRoutes(
  app: FastifyInstance,
  dependencies: BrowserWorkflowRouteDependencies,
): Promise<void> {
  const { coordinator } = dependencies;

  app.post('/workspace/runs', async (request, reply) => {
    const body = request.body as {
      mode?: BrowserRunMode;
      projectId?: string;
      prompt?: string;
      contextRefs?: string[];
      contextBudget?: number;
      provider?: BrowserProvider;
      verificationProfile?: VerificationProfile;
    };
    if ((body.mode !== 'ask' && body.mode !== 'agent') || !body.projectId || !body.prompt?.trim()) {
      return reply.code(400).send({ error: 'mode, projectId, and prompt are required' });
    }
    try {
      const run = await coordinator.create({
        mode: body.mode,
        projectId: body.projectId,
        prompt: body.prompt,
        contextRefs: body.contextRefs,
        contextBudget: body.contextBudget,
        provider: body.provider,
        verificationProfile: body.verificationProfile,
      });
      return reply.code(202).send(run);
    } catch (error) {
      if (isProjectNotFound(error)) return reply.code(404).send({ error: 'Project not found' });
      throw error;
    }
  });

  app.get('/workspace/runs', async (request) => {
    const query = request.query as { projectId?: string; limit?: string | number };
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    return { runs: await coordinator.list(query.projectId, limit) };
  });

  app.get('/workspace/runs/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const run = await coordinator.get(runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return run;
  });

  app.get('/workspace/runs/:runId/events', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const run = await coordinator.get(runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(run)}\n\n`);
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000);
    request.raw.on('close', () => clearInterval(heartbeat));
  });

  app.post('/workspace/runs/:runId/approve', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      previewRevision?: string;
      selectedOperationIds?: string[];
    };
    if (!body.previewRevision || !Array.isArray(body.selectedOperationIds)) {
      return reply.code(400).send({ error: 'previewRevision and selectedOperationIds are required' });
    }
    try {
      return await coordinator.approve(runId, {
        previewRevision: body.previewRevision,
        selectedOperationIds: body.selectedOperationIds,
      });
    } catch (error) {
      return sendWorkflowError(reply, error);
    }
  });

  app.post('/workspace/runs/:runId/apply', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as { approvalToken?: string };
    if (!body.approvalToken) return reply.code(400).send({ error: 'approvalToken is required' });
    try {
      return await coordinator.apply(runId, { approvalToken: body.approvalToken });
    } catch (error) {
      return sendWorkflowError(reply, error);
    }
  });

  app.post('/workspace/runs/:runId/reject', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    try {
      return await coordinator.reject(runId);
    } catch (error) {
      return sendWorkflowError(reply, error);
    }
  });

  app.post('/workspace/runs/:runId/cancel', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    try {
      return await coordinator.cancel(runId);
    } catch (error) {
      return sendWorkflowError(reply, error);
    }
  });
}

function sendWorkflowError(reply: FastifyReply, error: unknown) {
  if (error instanceof AgentApplicationError && error.code === 'STALE_PREVIEW') {
    return reply.code(409).send({
      error: 'STALE_PREVIEW',
      message: error.message,
      replacementPlans: error.replacementPlans,
      replacementPreviewRevision: error.replacementPreviewRevision,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/iu.test(message)) return reply.code(404).send({ error: message });
  if (/not awaiting|not ready|cannot be cancelled/iu.test(message)) {
    return reply.code(409).send({ error: message });
  }
  return reply.code(400).send({ error: message });
}

function isProjectNotFound(error: unknown): boolean {
  return error instanceof Error && /Project not found/iu.test(error.message);
}
