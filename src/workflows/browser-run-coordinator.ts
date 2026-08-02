import crypto from 'node:crypto';
import type { ProjectRecord } from '../projects/registry.js';
import { createOperationApprovalStore } from '../server/operation-approvals.js';
import { requiresExplicitApproval } from '../tools/registry.js';
import {
  AgentApplicationError,
  applyApprovedAgentRun,
  createPlannedOperationRevision,
  operationIdForIndex,
  prepareSelectedApproval,
  type PreparedSelectedApproval,
} from './agent-application.js';
import {
  prepareAgentRun,
  runAskWorkflow,
  type AgentSubmissionRequest,
  type PreparedAgentRun,
} from './agent-preparation.js';
import {
  createBrowserRunStore,
  type BrowserPreparedArtifact,
  type BrowserRunEvent,
  type BrowserRunStore,
} from './browser-run-store.js';
import type {
  BrowserOperationPreview,
  BrowserRunRecord,
  CreateBrowserRunInput,
} from './browser-run-types.js';

export interface BrowserRunCoordinatorDependencies {
  store?: BrowserRunStore;
  resolveProject(projectId: string): Promise<ProjectRecord>;
  submitAndWait(request: AgentSubmissionRequest, projectRoot: string): Promise<string>;
}

export interface BrowserRunApprovalRequest {
  previewRevision: string;
  selectedOperationIds: string[];
}

export interface BrowserRunApplyRequest {
  approvalToken: string;
}

export interface BrowserRunCoordinator {
  initialize(): Promise<void>;
  create(input: CreateBrowserRunInput): Promise<BrowserRunRecord>;
  get(runId: string): Promise<BrowserRunRecord | null>;
  list(projectId?: string, limit?: number): Promise<BrowserRunRecord[]>;
  events(runId: string, limit?: number): Promise<readonly BrowserRunEvent[]>;
  approve(runId: string, input: BrowserRunApprovalRequest): Promise<PreparedSelectedApproval>;
  apply(runId: string, input: BrowserRunApplyRequest): Promise<BrowserRunRecord>;
  reject(runId: string): Promise<BrowserRunRecord>;
  cancel(runId: string): Promise<BrowserRunRecord>;
}

interface InternalPreparedRun {
  project: ProjectRecord;
  prepared: PreparedAgentRun;
  plannedPreviewRevision: string;
  browserPreviewRevision: string;
  approval?: PreparedSelectedApproval;
}

export function createBrowserRunCoordinator(
  dependencies: BrowserRunCoordinatorDependencies,
): BrowserRunCoordinator {
  const store = dependencies.store ?? createBrowserRunStore();
  const approvals = createOperationApprovalStore();
  const preparedRuns = new Map<string, InternalPreparedRun>();
  let initializePromise: Promise<void> | null = null;

  const coordinator: BrowserRunCoordinator = {
    async initialize() {
      initializePromise ??= recoverRuns();
      await initializePromise;
    },

    async create(input) {
      await coordinator.initialize();
      const project = await dependencies.resolveProject(input.projectId);
      const run = await store.create({
        ...input,
        projectId: project.id,
        projectName: project.name,
      });
      await store.appendEvent(run.id, {
        type: 'project_selected',
        summary: `Selected ${project.name}`,
        details: { projectId: project.id },
      });
      schedulePreparation(run.id, project, run);
      return run;
    },

    async get(runId) {
      await coordinator.initialize();
      return store.get(runId);
    },

    async list(projectId, limit) {
      await coordinator.initialize();
      return store.list({ projectId, limit });
    },

    async events(runId, limit) {
      await coordinator.initialize();
      return store.events(runId, limit);
    },

    async approve(runId, input) {
      await coordinator.initialize();
      const snapshot = await requireRun(store, runId);
      if (snapshot.status !== 'awaiting_approval') {
        throw new Error('Run is not awaiting approval');
      }
      if (!snapshot.previewRevision || snapshot.previewRevision !== input.previewRevision) {
        throw new AgentApplicationError('STALE_PREVIEW', 'Preview revision no longer matches the run');
      }
      const internal = preparedRuns.get(runId);
      if (!internal) throw new Error('Prepared run is unavailable');

      await store.appendEvent(runId, {
        type: 'operation_selection',
        summary: `${input.selectedOperationIds.length} operation(s) selected`,
        details: { selectedOperationIds: input.selectedOperationIds },
      });
      const approval = await prepareSelectedApproval(
        {
          runId,
          projectRoot: internal.project.root,
          conversationId: internal.prepared.conversationId,
          operations: internal.prepared.operations,
          previews: internal.prepared.previews,
          previewRevision: internal.browserPreviewRevision,
          plannedPreviewRevision: internal.plannedPreviewRevision,
        },
        input.selectedOperationIds,
        internal.project.root,
        { approvals },
      );
      internal.approval = approval;
      await store.appendEvent(runId, {
        type: 'approval_prepared',
        summary: 'One-time approval prepared',
        details: {
          expiresAt: approval.expiresAt,
          selectedOperationIds: approval.selectedOperationIds,
          riskSummary: approval.riskSummary,
        },
      });
      await store.transition(runId, 'ready_to_apply');
      return approval;
    },

    async apply(runId, input) {
      await coordinator.initialize();
      const snapshot = await requireRun(store, runId);
      if (snapshot.status !== 'ready_to_apply') {
        throw new Error('Run is not ready to apply');
      }
      const internal = preparedRuns.get(runId);
      const approval = internal?.approval;
      if (!internal || !approval) throw new Error('Approval is unavailable');
      if (approval.approvalToken !== input.approvalToken) {
        throw new Error('Approval token does not match this run');
      }

      await store.appendEvent(runId, {
        type: 'apply_started',
        summary: `${approval.selectedOperationIds.length} operation(s) entering apply`,
        details: { selectedOperationIds: approval.selectedOperationIds },
      });
      await store.transition(runId, 'applying');
      const verificationProfile = snapshot.verification?.profile;

      try {
        const result = await applyApprovedAgentRun(
          {
            runId,
            projectRoot: internal.project.root,
            conversationId: internal.prepared.conversationId,
            approvalToken: input.approvalToken,
            previewRevision: internal.browserPreviewRevision,
            selectedOperationIds: [...approval.selectedOperationIds],
            verificationProfile,
          },
          { approvals },
        );
        internal.approval = undefined;
        await store.appendEvent(runId, {
          type: 'operation_result',
          summary: `${result.operationCount} operation(s) applied`,
          details: { changedPaths: result.changedPaths },
        });

        let verification = snapshot.verification;
        if (result.verification) {
          await store.transition(runId, 'verifying', {
            verification: { profile: result.verification.profile, status: 'running' },
          });
          verification = {
            profile: result.verification.profile,
            status: result.verification.status === 'passed' ? 'passed' : 'failed',
            summary: result.verification.error
              ? `${result.verification.summary}: ${result.verification.error}`
              : result.verification.summary,
          };
          await store.appendEvent(runId, {
            type: 'verification_result',
            summary: verification.summary ?? verification.status,
            details: { profile: verification.profile, status: verification.status },
          });
        }
        preparedRuns.delete(runId);
        return await store.transition(runId, 'completed', { verification });
      } catch (error) {
        internal.approval = undefined;
        if (error instanceof AgentApplicationError && error.code === 'STALE_PREVIEW') {
          const replacementPlans = [...(error.replacementPlans ?? [])];
          if (replacementPlans.length === 0) throw error;
          const prepared: PreparedAgentRun = {
            ...internal.prepared,
            operations: Object.freeze(replacementPlans.map((item) => item.operation)),
            previews: Object.freeze(replacementPlans),
          };
          const browserOperations = toBrowserPreviews(prepared);
          const previewed = await store.setPreview(runId, browserOperations);
          if (!previewed.previewRevision) throw error;
          internal.prepared = prepared;
          internal.plannedPreviewRevision = createPlannedOperationRevision(
            internal.project.root,
            replacementPlans,
          );
          internal.browserPreviewRevision = previewed.previewRevision;
          await persistPrepared(store, runId, internal);
          await store.transition(runId, 'awaiting_approval');
          await store.appendEvent(runId, {
            type: 'stale_preview',
            summary: 'Filesystem changed after approval; review required again',
            details: { previewRevision: previewed.previewRevision },
          });
          throw new AgentApplicationError('STALE_PREVIEW', error.message, {
            cause: error,
            replacementPlans,
            replacementPreviewRevision: previewed.previewRevision,
          });
        }
        await store.transition(runId, 'failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    async reject(runId) {
      await coordinator.initialize();
      preparedRuns.delete(runId);
      await store.appendEvent(runId, { type: 'rejected', summary: 'Run rejected by user' });
      return store.transition(runId, 'rejected');
    },

    async cancel(runId) {
      await coordinator.initialize();
      const snapshot = await requireRun(store, runId);
      if (snapshot.status === 'applying' || snapshot.status === 'verifying') {
        throw new Error('Run cannot be cancelled after apply starts');
      }
      preparedRuns.delete(runId);
      await store.appendEvent(runId, { type: 'cancelled', summary: 'Run cancelled by user' });
      return store.transition(runId, 'cancelled');
    },
  };

  async function recoverRuns(): Promise<void> {
    const runs = await store.recover();
    for (const run of runs) {
      try {
        const project = await dependencies.resolveProject(run.projectId);
        if (run.status === 'queued') {
          schedulePreparation(run.id, project, run);
          continue;
        }
        const artifact = await store.getPrepared(run.id);
        if (!artifact || !run.previewRevision) {
          await store.transition(run.id, 'failed', {
            error: 'RECOVERY_REVIEW_REQUIRED: prepared run artifact is unavailable',
          });
          continue;
        }
        preparedRuns.set(run.id, {
          project,
          prepared: restorePreparedRun(run, artifact),
          plannedPreviewRevision: artifact.plannedPreviewRevision,
          browserPreviewRevision: run.previewRevision,
        });
        await store.appendEvent(run.id, {
          type: 'recovery_restored',
          summary: 'Approval review restored without an approval capability',
        });
      } catch (error) {
        const current = await store.get(run.id);
        if (current && current.status !== 'failed') {
          await store.transition(run.id, 'failed', {
            error: `RECOVERY_REVIEW_REQUIRED: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }
  }

  function schedulePreparation(
    runId: string,
    project: ProjectRecord,
    run: BrowserRunRecord,
  ): void {
    queueMicrotask(() => {
      void prepareRun(runId, project, run).catch(async (error) => {
        await failRun(store, runId, error);
      });
    });
  }

  async function prepareRun(
    runId: string,
    project: ProjectRecord,
    run: BrowserRunRecord,
  ): Promise<void> {
    await store.appendEvent(runId, {
      type: 'preparation_started',
      summary: 'Building local project context',
    });
    await store.transition(runId, 'building_context');
    if ((await requireRun(store, runId)).status === 'cancelled') return;
    await store.transition(runId, 'waiting_for_model');
    const conversationId = crypto.randomUUID();
    const submitAndWait = (request: AgentSubmissionRequest) =>
      dependencies.submitAndWait(request, project.root);

    if (run.mode === 'ask') {
      const result = await runAskWorkflow(
        {
          projectRoot: project.root,
          prompt: run.prompt,
          contextRefs: run.contextRefs,
          contextBudget: run.contextBudget,
          conversationId,
          includeSystemInstructions: true,
        },
        { submitAndWait },
      );
      const current = await requireRun(store, runId);
      if (current.status === 'cancelled') return;
      await store.appendEvent(runId, {
        type: 'model_completed',
        summary: 'Ask response captured',
        details: { responseText: result.responseText },
      });
      await store.transition(runId, 'validating_response');
      await store.transition(runId, 'completed', { responseText: result.responseText });
      return;
    }

    const prepared = await prepareAgentRun(
      {
        projectRoot: project.root,
        task: run.prompt,
        contextRefs: run.contextRefs,
        contextBudget: run.contextBudget,
        conversationId,
        includeSystemInstructions: true,
      },
      { submitAndWait },
    );
    const current = await requireRun(store, runId);
    if (current.status === 'cancelled') return;
    await store.appendEvent(runId, {
      type: 'model_completed',
      summary: 'Agent response captured and validated',
      details: { operationCount: prepared.operations.length, rawResponse: prepared.rawResponse },
    });
    await store.transition(runId, 'validating_response');
    const operations = toBrowserPreviews(prepared);
    const previewed = await store.setPreview(runId, operations);
    if (!previewed.previewRevision) throw new Error('Preview revision was not created');
    const internal: InternalPreparedRun = {
      project,
      prepared,
      plannedPreviewRevision: createPlannedOperationRevision(project.root, prepared.previews),
      browserPreviewRevision: previewed.previewRevision,
    };
    preparedRuns.set(runId, internal);
    await persistPrepared(store, runId, internal);
    await store.transition(runId, 'awaiting_approval');
  }

  return coordinator;
}

async function persistPrepared(
  store: BrowserRunStore,
  runId: string,
  internal: InternalPreparedRun,
): Promise<void> {
  await store.setPrepared(runId, {
    conversationId: internal.prepared.conversationId,
    rawResponse: internal.prepared.rawResponse,
    operations: [...internal.prepared.operations],
    previews: [...internal.prepared.previews],
    plannedPreviewRevision: internal.plannedPreviewRevision,
  });
}

function restorePreparedRun(
  run: BrowserRunRecord,
  artifact: BrowserPreparedArtifact,
): PreparedAgentRun {
  return {
    conversationId: artifact.conversationId,
    userTask: run.prompt,
    contextRefs: Object.freeze([...run.contextRefs]),
    contextSummary: {
      references: [...run.contextRefs],
      includedFiles: 0,
      totalCharacters: 0,
      limitCharacters: run.contextBudget ?? 0,
      sensitiveExcluded: 0,
      memoryAttached: false,
    },
    rawResponse: artifact.rawResponse,
    operations: Object.freeze([...artifact.operations]),
    previews: Object.freeze([...artifact.previews]),
  };
}

function toBrowserPreviews(prepared: PreparedAgentRun): BrowserOperationPreview[] {
  return prepared.previews.map((plan, index) => ({
    id: operationIdForIndex(index),
    action: plan.operation.action,
    path: 'path' in plan.operation ? plan.operation.path : undefined,
    risk: plan.risk,
    summary: plan.diff.split(/\r?\n/u, 1)[0] || plan.operation.action,
    diff: plan.diff,
    requiresExplicitApproval: requiresExplicitApproval(plan.risk),
  }));
}

async function requireRun(store: BrowserRunStore, runId: string): Promise<BrowserRunRecord> {
  const run = await store.get(runId);
  if (!run) throw new Error(`Browser run not found: ${runId}`);
  return run;
}

async function failRun(
  store: BrowserRunStore,
  runId: string,
  error: unknown,
): Promise<void> {
  const run = await store.get(runId);
  if (!run || ['completed', 'rejected', 'cancelled', 'failed'].includes(run.status)) return;
  await store.appendEvent(runId, {
    type: 'failure',
    summary: error instanceof Error ? error.message : String(error),
  });
  await store.transition(runId, 'failed', {
    error: error instanceof Error ? error.message : String(error),
  });
}
