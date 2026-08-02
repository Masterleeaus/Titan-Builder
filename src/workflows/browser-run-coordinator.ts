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
  create(input: CreateBrowserRunInput): Promise<BrowserRunRecord>;
  get(runId: string): Promise<BrowserRunRecord | null>;
  list(projectId?: string, limit?: number): Promise<BrowserRunRecord[]>;
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

  const coordinator: BrowserRunCoordinator = {
    async create(input) {
      const project = await dependencies.resolveProject(input.projectId);
      const run = await store.create({
        ...input,
        projectId: project.id,
        projectName: project.name,
      });
      queueMicrotask(() => {
        void prepareRun(run.id, project, run).catch(async (error) => {
          await failRun(store, run.id, error);
        });
      });
      return run;
    },

    get: (runId) => store.get(runId),

    list: (projectId, limit) => store.list({ projectId, limit }),

    async approve(runId, input) {
      const snapshot = await requireRun(store, runId);
      if (snapshot.status !== 'awaiting_approval') {
        throw new Error('Run is not awaiting approval');
      }
      if (!snapshot.previewRevision || snapshot.previewRevision !== input.previewRevision) {
        throw new AgentApplicationError('STALE_PREVIEW', 'Preview revision no longer matches the run');
      }
      const internal = preparedRuns.get(runId);
      if (!internal) throw new Error('Prepared run is unavailable');

      const approval = await prepareSelectedApproval(
        {
          runId,
          projectRoot: internal.project.root,
          conversationId: internal.prepared.conversationId,
          operations: internal.prepared.operations,
          previews: internal.prepared.previews,
          previewRevision: internal.plannedPreviewRevision,
        },
        input.selectedOperationIds,
        internal.project.root,
        { approvals },
      );
      internal.approval = approval;
      await store.transition(runId, 'ready_to_apply');
      return approval;
    },

    async apply(runId, input) {
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

      await store.transition(runId, 'applying');
      const verificationProfile = snapshot.verification?.profile;
      if (verificationProfile) {
        await store.transition(runId, 'verifying', {
          verification: { profile: verificationProfile, status: 'running' },
        });
      }

      try {
        const result = await applyApprovedAgentRun(
          {
            runId,
            projectRoot: internal.project.root,
            conversationId: internal.prepared.conversationId,
            approvalToken: input.approvalToken,
            previewRevision: internal.plannedPreviewRevision,
            selectedOperationIds: [...approval.selectedOperationIds],
            verificationProfile,
          },
          { approvals },
        );
        internal.approval = undefined;
        const verification = result.verification
          ? {
              profile: result.verification.profile,
              status: result.verification.status === 'passed' ? 'passed' as const : 'failed' as const,
              summary: result.verification.error
                ? `${result.verification.summary}: ${result.verification.error}`
                : result.verification.summary,
            }
          : snapshot.verification;
        return await store.transition(runId, 'completed', { verification });
      } catch (error) {
        internal.approval = undefined;
        throw error;
      }
    },

    async reject(runId) {
      preparedRuns.delete(runId);
      return store.transition(runId, 'rejected');
    },

    async cancel(runId) {
      const snapshot = await requireRun(store, runId);
      if (snapshot.status === 'applying' || snapshot.status === 'verifying') {
        throw new Error('Run cannot be cancelled after apply starts');
      }
      preparedRuns.delete(runId);
      return store.transition(runId, 'cancelled');
    },
  };

  async function prepareRun(
    runId: string,
    project: ProjectRecord,
    run: BrowserRunRecord,
  ): Promise<void> {
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
    await store.transition(runId, 'validating_response');
    const operations = toBrowserPreviews(prepared);
    const previewed = await store.setPreview(runId, operations);
    if (!previewed.previewRevision) throw new Error('Preview revision was not created');
    preparedRuns.set(runId, {
      project,
      prepared,
      plannedPreviewRevision: createPlannedOperationRevision(project.root, prepared.previews),
      browserPreviewRevision: previewed.previewRevision,
    });
    await store.transition(runId, 'awaiting_approval');
  }

  return coordinator;
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
  await store.transition(runId, 'failed', {
    error: error instanceof Error ? error.message : String(error),
  });
}
