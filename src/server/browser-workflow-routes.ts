import type { FastifyInstance, FastifyReply } from 'fastify';
import { TOOL_MANIFEST_SCHEMA_VERSION } from '../tools/manifest.js';
import { createToolKnowledgeRecords } from '../tools/knowledge.js';
import { listToolManifests } from '../tools/registry.js';
import { bridgeBodyLimit } from './body-limits.js';
import { AgentApplicationError } from '../workflows/agent-application.js';
import type { BrowserRunCoordinator } from '../workflows/browser-run-coordinator.js';
import type {
  BrowserProvider,
  BrowserRunMode,
  VerificationProfile,
} from '../workflows/browser-run-types.js';

export interface BrowserWorkflowRouteDependencies {
  coordinator: BrowserRunCoordinator;
}

const TERMINAL_STATUSES = new Set(['completed', 'rejected', 'cancelled', 'failed']);

export async function registerBrowserWorkflowRoutes(
  app: FastifyInstance,
  dependencies: BrowserWorkflowRouteDependencies,
): Promise<void> {
  const { coordinator } = dependencies;

  app.get('/tools', async () => ({
    schemaVersion: TOOL_MANIFEST_SCHEMA_VERSION,
    tools: listToolManifests(),
    knowledge: createToolKnowledgeRecords(),
  }));

  app.post('/workspace/runs', bridgeBodyLimit('/workspace/runs'), async (request, reply) => {
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

  app.get('/workspace/runs/:runId/audit', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const query = request.query as { limit?: string | number };
    const run = await coordinator.get(runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    return { events: await coordinator.events(runId, limit) };
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
    let lastUpdatedAt = run.updatedAt;
    const updates = setInterval(() => {
      void coordinator.get(runId).then((snapshot) => {
        if (!snapshot || reply.raw.destroyed) return;
        if (snapshot.updatedAt !== lastUpdatedAt) {
          lastUpdatedAt = snapshot.updatedAt;
          reply.raw.write(`event: update\ndata: ${JSON.stringify(snapshot)}\n\n`);
        }
        if (TERMINAL_STATUSES.has(snapshot.status)) {
          clearInterval(updates);
          clearInterval(heartbeat);
          reply.raw.end();
        }
      }).catch((error) => {
        logger.warn({ runId, error }, 'SSE update fetch failed');
      });
    }, 1000);
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000);
    request.raw.on('close', () => {
      clearInterval(updates);
      clearInterval(heartbeat);
    });
  });

  app.post('/workspace/runs/:runId/approve', bridgeBodyLimit('/workspace/runs/:runId/approve'), async (request, reply) => {
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
      return sendWorkflowError(reply, error, coordinator, runId);
    }
  });

  app.post('/workspace/runs/:runId/apply', bridgeBodyLimit('/workspace/runs/:runId/apply'), async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as { approvalToken?: string };
    if (!body.approvalToken) return reply.code(400).send({ error: 'approvalToken is required' });
    try {
      return await coordinator.apply(runId, { approvalToken: body.approvalToken });
    } catch (error) {
      return sendWorkflowError(reply, error, coordinator, runId);
    }
  });

  app.post('/workspace/runs/:runId/reject', bridgeBodyLimit('/workspace/runs/:runId/reject'), async (request, reply) => {
    const { runId } = request.params as { runId: string };
    try {
      return await coordinator.reject(runId);
    } catch (error) {
      return sendWorkflowError(reply, error, coordinator, runId);
    }
  });

  app.post('/workspace/runs/:runId/cancel', bridgeBodyLimit('/workspace/runs/:runId/cancel'), async (request, reply) => {
    const { runId } = request.params as { runId: string };
    try {
      return await coordinator.cancel(runId);
    } catch (error) {
      return sendWorkflowError(reply, error, coordinator, runId);
    }
  });
}

async function sendWorkflowError(
  reply: FastifyReply,
  error: unknown,
  coordinator: BrowserRunCoordinator,
  runId: string,
) {
  if (error instanceof AgentApplicationError && error.code === 'STALE_PREVIEW') {
    return reply.code(409).send({
      error: 'STALE_PREVIEW',
      message: error.message,
      replacementPreviewRevision: error.replacementPreviewRevision,
      snapshot: await coordinator.get(runId),
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
