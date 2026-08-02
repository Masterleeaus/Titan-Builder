import path from 'node:path';
import type { FileOperation } from '../core/types/index.js';
import {
  executePlannedOperations,
  planOperations,
  type ExecuteOptions,
  type PlannedOperation,
} from '../operations/index.js';
import {
  captureRepositoryIdentity,
  sameRepositoryIdentity,
  type RepositoryIdentity,
} from '../security/repository-identity.js';
import {
  createOperationApprovalStore,
  createOperationPlanRevision,
  type OperationApprovalStore,
} from '../server/operation-approvals.js';
import {
  runProjectVerification,
  type ProjectVerificationResult,
} from '../verification/index.js';
import type { VerificationProfile } from '../verification/plan.js';

export interface PreparedRunForApproval {
  runId: string;
  projectRoot?: string;
  conversationId: string;
  operations: readonly FileOperation[];
  previews: readonly PlannedOperation[];
  previewRevision: string;
  plannedPreviewRevision?: string;
}

export interface PreparedSelectedApproval {
  approvalToken: string;
  expiresAt: number;
  previewHash: string;
  previewRevision: string;
  selectedPreviewRevision: string;
  repositoryIdentity: RepositoryIdentity;
  selectedOperationIds: readonly string[];
  selectedOperations: readonly FileOperation[];
  selectedPlans: readonly PlannedOperation[];
  riskSummary: Readonly<Record<string, number>>;
}

export interface ApplyApprovedAgentRunInput {
  runId: string;
  projectRoot: string;
  conversationId: string;
  approvalToken: string;
  previewRevision: string;
  selectedOperationIds: readonly string[];
  verificationProfile?: VerificationProfile;
}

export interface AppliedAgentRunResult {
  runId: string;
  operationCount: number;
  changedPaths: readonly string[];
  verification?: ProjectVerificationResult;
}

export interface AgentApplicationDependencies {
  approvals?: OperationApprovalStore;
  plan?: typeof planOperations;
  execute?: typeof executePlannedOperations;
  verify?: typeof runProjectVerification;
  captureIdentity?: typeof captureRepositoryIdentity;
  onStep?: ExecuteOptions['onStep'];
}

export type AgentApplicationErrorCode =
  | 'INVALID_SELECTION'
  | 'STALE_PREVIEW'
  | 'APPROVAL_INVALID';

export class AgentApplicationError extends Error {
  readonly code: AgentApplicationErrorCode;
  readonly replacementPlans?: readonly PlannedOperation[];
  readonly replacementPreviewRevision?: string;

  constructor(
    code: AgentApplicationErrorCode,
    message: string,
    options: ErrorOptions & {
      replacementPlans?: readonly PlannedOperation[];
      replacementPreviewRevision?: string;
    } = {},
  ) {
    super(message, options);
    this.name = 'AgentApplicationError';
    this.code = code;
    this.replacementPlans = options.replacementPlans
      ? freezeClone(options.replacementPlans)
      : undefined;
    this.replacementPreviewRevision = options.replacementPreviewRevision;
  }
}

const defaultApprovals = createOperationApprovalStore();

export function createPlannedOperationRevision(
  projectRoot: string,
  plans: readonly PlannedOperation[],
): string {
  return createOperationPlanRevision(projectRoot, plans);
}

export function operationIdForIndex(index: number): string {
  return `op-${index + 1}`;
}

export async function prepareSelectedApproval(
  preparedRun: PreparedRunForApproval,
  selectedOperationIds: readonly string[],
  projectRoot: string,
  dependencies: AgentApplicationDependencies = {},
): Promise<PreparedSelectedApproval> {
  const requestedRoot = requireText(projectRoot, 'projectRoot');
  const runId = requireText(preparedRun.runId, 'runId');
  const conversationId = requireText(
    preparedRun.conversationId,
    'conversationId',
  );
  if (
    preparedRun.projectRoot &&
    path.resolve(preparedRun.projectRoot) !== path.resolve(requestedRoot)
  ) {
    throw new AgentApplicationError(
      'APPROVAL_INVALID',
      'Prepared run is bound to a different project root',
    );
  }

  const captureIdentity = dependencies.captureIdentity ?? captureRepositoryIdentity;
  const identityBeforePlan = await captureIdentityForApproval(
    requestedRoot,
    'reviewed repository identity could not be captured',
    captureIdentity,
  );
  const root = identityBeforePlan.projectRoot;
  const reviewedPlans = [...preparedRun.previews];
  const reviewedRevision = createPlannedOperationRevision(root, reviewedPlans);
  const expectedPlannedRevision =
    preparedRun.plannedPreviewRevision ?? preparedRun.previewRevision;
  if (reviewedRevision !== expectedPlannedRevision) {
    throw new AgentApplicationError(
      'STALE_PREVIEW',
      'Preview is stale or no longer matches the reviewed operations',
      {
        replacementPlans: reviewedPlans,
        replacementPreviewRevision: reviewedRevision,
      },
    );
  }

  const selectedIds = normalizeSelectedIds(selectedOperationIds);
  const selectedEntries = selectReviewedPlans(reviewedPlans, selectedIds);
  const selectedOperations = selectedEntries.map((entry) => entry.plan.operation);
  const reviewedSelectedPlans = selectedEntries.map((entry) => entry.plan);
  const plan = dependencies.plan ?? planOperations;
  const currentPlans = await plan(selectedOperations, root);
  const identityAfterPlan = await captureIdentityForApproval(
    root,
    'repository identity changed while approval was prepared',
    captureIdentity,
  );
  if (!sameRepositoryIdentity(identityBeforePlan, identityAfterPlan)) {
    throw new AgentApplicationError(
      'STALE_PREVIEW',
      'Preview is stale because repository identity changed during approval preparation',
      { replacementPlans: currentPlans },
    );
  }

  const reviewedSelectedRevision = createPlannedOperationRevision(
    root,
    reviewedSelectedPlans,
  );
  const currentSelectedRevision = createPlannedOperationRevision(
    root,
    currentPlans,
  );

  if (reviewedSelectedRevision !== currentSelectedRevision) {
    throw new AgentApplicationError(
      'STALE_PREVIEW',
      'Preview is stale because the project changed after review',
      {
        replacementPlans: currentPlans,
        replacementPreviewRevision: currentSelectedRevision,
      },
    );
  }

  const approvals = dependencies.approvals ?? defaultApprovals;
  const issued = approvals.issue({
    runId,
    projectRoot: root,
    repositoryIdentity: identityAfterPlan,
    conversationId,
    previewRevision: preparedRun.previewRevision,
    selectedOperationIds: selectedIds,
    plans: currentPlans,
  });

  return {
    approvalToken: issued.token,
    expiresAt: issued.expiresAt,
    previewHash: issued.previewHash,
    previewRevision: preparedRun.previewRevision,
    selectedPreviewRevision: issued.selectedPreviewRevision,
    repositoryIdentity: freezeClone(identityAfterPlan),
    selectedOperationIds: freezeClone(selectedIds),
    selectedOperations: freezeClone(selectedOperations),
    selectedPlans: freezeClone(currentPlans),
    riskSummary: freezeClone(issued.riskSummary),
  };
}

export async function applyApprovedAgentRun(
  input: ApplyApprovedAgentRunInput,
  dependencies: AgentApplicationDependencies = {},
): Promise<AppliedAgentRunResult> {
  const runId = requireText(input.runId, 'runId');
  const requestedRoot = requireText(input.projectRoot, 'projectRoot');
  const conversationId = requireText(input.conversationId, 'conversationId');
  const approvalToken = requireText(input.approvalToken, 'approvalToken');
  const previewRevision = requireText(input.previewRevision, 'previewRevision');
  const selectedOperationIds = normalizeSelectedIds(input.selectedOperationIds);
  const approvals = dependencies.approvals ?? defaultApprovals;
  const captureIdentity = dependencies.captureIdentity ?? captureRepositoryIdentity;
  const identityBeforePlan = await captureIdentityForApply(
    requestedRoot,
    approvalToken,
    approvals,
    captureIdentity,
  );
  const projectRoot = identityBeforePlan.projectRoot;
  const expectation = {
    runId,
    projectRoot,
    repositoryIdentity: identityBeforePlan,
    conversationId,
    previewRevision,
    selectedOperationIds,
  };

  let inspection;
  try {
    inspection = approvals.inspect(approvalToken, expectation);
  } catch (error) {
    const message = formatUnknownError(error);
    if (/repository identity/i.test(message)) {
      approvals.revoke(approvalToken);
      throw new AgentApplicationError(
        'STALE_PREVIEW',
        'Preview is stale because repository identity changed after approval',
        { cause: error },
      );
    }
    throw new AgentApplicationError(
      'APPROVAL_INVALID',
      message,
      { cause: error },
    );
  }

  const plan = dependencies.plan ?? planOperations;
  const operations = inspection.plans.map((item) => item.operation);
  const currentPlans = await plan(operations, projectRoot);
  const currentRevision = createPlannedOperationRevision(projectRoot, currentPlans);
  if (currentRevision !== inspection.selectedPreviewRevision) {
    approvals.revoke(approvalToken);
    throw new AgentApplicationError(
      'STALE_PREVIEW',
      'Preview is stale because the project changed after approval',
      {
        replacementPlans: currentPlans,
        replacementPreviewRevision: currentRevision,
      },
    );
  }

  const identityBeforeConsume = await captureIdentityForApply(
    projectRoot,
    approvalToken,
    approvals,
    captureIdentity,
  );
  if (
    !sameRepositoryIdentity(identityBeforePlan, identityBeforeConsume) ||
    !sameRepositoryIdentity(inspection.repositoryIdentity, identityBeforeConsume)
  ) {
    approvals.revoke(approvalToken);
    throw new AgentApplicationError(
      'STALE_PREVIEW',
      'Preview is stale because repository identity changed during approval validation',
      {
        replacementPlans: currentPlans,
        replacementPreviewRevision: currentRevision,
      },
    );
  }

  try {
    approvals.consume(approvalToken, {
      ...expectation,
      repositoryIdentity: identityBeforeConsume,
    });
  } catch (error) {
    const message = formatUnknownError(error);
    if (/repository identity/i.test(message)) {
      throw new AgentApplicationError(
        'STALE_PREVIEW',
        'Preview is stale because repository identity changed before approval consumption',
        { cause: error },
      );
    }
    throw new AgentApplicationError(
      'APPROVAL_INVALID',
      message,
      { cause: error },
    );
  }

  const execute = dependencies.execute ?? executePlannedOperations;
  await execute(currentPlans, projectRoot, {
    conversationId,
    onStep: dependencies.onStep,
  });

  const changedPaths = uniqueText(
    currentPlans.flatMap((item) => operationChangedPaths(item.operation)),
  );

  let verification: ProjectVerificationResult | undefined;
  if (input.verificationProfile) {
    const verify = dependencies.verify ?? runProjectVerification;
    verification = await verify(projectRoot, input.verificationProfile, {
      onStep: dependencies.onStep,
    });
  }

  return {
    runId,
    operationCount: currentPlans.length,
    changedPaths: freezeClone(changedPaths),
    verification,
  };
}

async function captureIdentityForApproval(
  projectRoot: string,
  message: string,
  captureIdentity: typeof captureRepositoryIdentity,
): Promise<RepositoryIdentity> {
  try {
    return await captureIdentity(projectRoot);
  } catch (error) {
    throw new AgentApplicationError(
      'STALE_PREVIEW',
      `${message}: ${formatUnknownError(error)}`,
      { cause: error },
    );
  }
}

async function captureIdentityForApply(
  projectRoot: string,
  approvalToken: string,
  approvals: OperationApprovalStore,
  captureIdentity: typeof captureRepositoryIdentity,
): Promise<RepositoryIdentity> {
  try {
    return await captureIdentity(projectRoot);
  } catch (error) {
    approvals.revoke(approvalToken);
    throw new AgentApplicationError(
      'STALE_PREVIEW',
      `Preview is stale because repository identity could not be revalidated: ${formatUnknownError(error)}`,
      { cause: error },
    );
  }
}

function selectReviewedPlans(
  plans: readonly PlannedOperation[],
  selectedIds: readonly string[],
): Array<{ id: string; plan: PlannedOperation }> {
  const byId = new Map(
    plans.map((plan, index) => [operationIdForIndex(index), plan] as const),
  );
  return selectedIds.map((id) => {
    const plan = byId.get(id);
    if (!plan) {
      throw new AgentApplicationError(
        'INVALID_SELECTION',
        `Unknown selected operation: ${id}`,
      );
    }
    return { id, plan };
  });
}

function normalizeSelectedIds(values: readonly string[]): string[] {
  const normalized = values
    .map((value) => requireText(value, 'selectedOperationId'))
    .filter(Boolean);
  if (normalized.length === 0) {
    throw new AgentApplicationError(
      'INVALID_SELECTION',
      'At least one operation must be selected',
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new AgentApplicationError(
      'INVALID_SELECTION',
      'Selected operation IDs must be unique',
    );
  }
  return normalized;
}

function operationChangedPaths(operation: FileOperation): string[] {
  switch (operation.action) {
    case 'RUN_TOOL':
    case 'RUN_COMMAND':
      return [];
    case 'RENAME_FILE':
      return definedText([operation.path, operation.replace]);
    default:
      return definedText([operation.path]);
  }
}

function definedText(values: readonly (string | undefined)[]): string[] {
  return values.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function requireText(value: string, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function freezeClone<T>(value: T): T {
  const clone = structuredClone(value);
  return deepFreeze(clone);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
