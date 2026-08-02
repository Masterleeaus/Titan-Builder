import type { FileOperation } from '../core/types/index.js';
import {
  buildBudgetedContext,
  formatAgentContextJson,
  formatBudgetedContextMarkdown,
  generateContext,
  parseAtRefs,
} from '../context/index.js';
import {
  formatProjectMemory,
  listProjectMemory,
} from '../memory/project-memory.js';
import {
  planOperations,
  type PlannedOperation,
} from '../operations/index.js';
import { parseAIResponse } from '../parser/index.js';
import {
  buildAgentCompactRetryMessage,
  buildAgentSystemPrompt,
  buildAskSystemPrompt,
  buildFullMessage,
  isMarkdownDraftRequest,
} from '../prompts/system.js';

export interface AgentSubmissionRequest {
  mode: 'ask' | 'agent';
  prompt: string;
  systemPrompt: string;
  message: string;
  conversationId: string;
  markdownDraft?: boolean;
  attempt: number;
  maxAttempts: number;
}

export interface PreparationContextSummary {
  references: string[];
  includedFiles: number;
  totalCharacters: number;
  limitCharacters: number;
  sensitiveExcluded: number;
  memoryAttached: boolean;
}

export type PreparationEvent =
  | {
      type: 'context_ready';
      mode: 'ask' | 'agent';
      summary: PreparationContextSummary;
    }
  | {
      type: 'submission_started';
      request: AgentSubmissionRequest;
    }
  | {
      type: 'response_received';
      mode: 'ask' | 'agent';
      attempt: number;
    }
  | {
      type: 'validating_response';
      attempt: number;
    }
  | {
      type: 'retrying';
      attempt: number;
      maxAttempts: number;
      category: 'capture' | 'empty' | 'validation';
      reason: string;
    };

export interface AgentPreparationDependencies {
  submitAndWait(request: AgentSubmissionRequest): Promise<string>;
  onEvent?: (event: PreparationEvent) => Promise<void>;
  buildContext?: typeof buildBudgetedContext;
  generateProjectContext?: typeof generateContext;
  readProjectMemory?: typeof listProjectMemory;
  parseResponse?: typeof parseAIResponse;
  plan?: typeof planOperations;
}

export interface PrepareAgentRunInput {
  projectRoot: string;
  task: string;
  contextRefs: string[];
  contextBudget?: number;
  conversationId: string;
  includeSystemInstructions?: boolean;
  maxAttempts?: number;
}

export interface PreparedAgentRun {
  conversationId: string;
  userTask: string;
  contextRefs: readonly string[];
  contextSummary: PreparationContextSummary;
  rawResponse: string;
  operations: readonly FileOperation[];
  previews: readonly PlannedOperation[];
}

export interface RunAskWorkflowInput {
  projectRoot: string;
  prompt: string;
  contextRefs: string[];
  contextBudget?: number;
  conversationId: string;
  includeSystemInstructions?: boolean;
}

export interface AskWorkflowResult {
  conversationId: string;
  userPrompt: string;
  contextRefs: readonly string[];
  contextSummary: PreparationContextSummary;
  markdownDraft: boolean;
  responseText: string;
}

export type AgentPreparationErrorCode =
  | 'CAPTURE_FAILED'
  | 'EMPTY_RESPONSE'
  | 'INVALID_RESPONSE';

export class AgentPreparationError extends Error {
  readonly code: AgentPreparationErrorCode;
  readonly attempt: number;

  constructor(
    code: AgentPreparationErrorCode,
    message: string,
    attempt: number,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'AgentPreparationError';
    this.code = code;
    this.attempt = attempt;
  }
}

export async function prepareAgentRun(
  input: PrepareAgentRunInput,
  dependencies: AgentPreparationDependencies,
): Promise<PreparedAgentRun> {
  const projectRoot = requireText(input.projectRoot, 'projectRoot');
  const conversationId = requireText(input.conversationId, 'conversationId');
  const parsed = parseAtRefs(requireText(input.task, 'task'));
  const userTask = parsed.cleanPrompt || input.task.trim();
  const contextRefs = uniqueText([...(input.contextRefs ?? []), ...parsed.paths]);
  const maxAttempts = normalizeAttempts(input.maxAttempts);
  const context = await buildAgentContext(
    projectRoot,
    contextRefs,
    input.contextBudget,
    dependencies,
  );

  await emit(dependencies, {
    type: 'context_ready',
    mode: 'agent',
    summary: context.summary,
  });

  const systemPrompt = buildAgentSystemPrompt(conversationId);
  let includeSystemInstructions = input.includeSystemInstructions ?? true;
  let hasRetriedWithFullSystem = false;
  let message = buildFullMessage('agent', systemPrompt, userTask, context.block, {
    includeSystemInstructions,
  });
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const request: AgentSubmissionRequest = {
      mode: 'agent',
      prompt: userTask,
      systemPrompt,
      message,
      conversationId,
      attempt,
      maxAttempts,
    };
    await emit(dependencies, { type: 'submission_started', request });

    let rawResponse: string;
    try {
      rawResponse = await dependencies.submitAndWait(request);
      await emit(dependencies, {
        type: 'response_received',
        mode: 'agent',
        attempt,
      });
    } catch (error) {
      lastError = error;
      const reason = formatUnknownError(error);
      if (attempt >= maxAttempts) {
        throw new AgentPreparationError(
          'CAPTURE_FAILED',
          reason,
          attempt,
          { cause: error },
        );
      }
      await emit(dependencies, {
        type: 'retrying',
        attempt,
        maxAttempts,
        category: 'capture',
        reason,
      });
      const retry = createRetryMessage(
        reason,
        conversationId,
        userTask,
        systemPrompt,
        context.block,
        hasRetriedWithFullSystem,
      );
      message = retry.message;
      hasRetriedWithFullSystem = retry.hasRetriedWithFullSystem;
      includeSystemInstructions = retry.includeSystemInstructions;
      continue;
    }

    if (!rawResponse.trim()) {
      const reason = 'Empty response from browser AI';
      if (attempt >= maxAttempts) {
        throw new AgentPreparationError('EMPTY_RESPONSE', reason, attempt);
      }
      await emit(dependencies, {
        type: 'retrying',
        attempt,
        maxAttempts,
        category: 'empty',
        reason,
      });
      const retry = createRetryMessage(
        reason,
        conversationId,
        userTask,
        systemPrompt,
        context.block,
        hasRetriedWithFullSystem,
      );
      message = retry.message;
      hasRetriedWithFullSystem = retry.hasRetriedWithFullSystem;
      includeSystemInstructions = retry.includeSystemInstructions;
      continue;
    }

    try {
      await emit(dependencies, { type: 'validating_response', attempt });
      const parseResponse = dependencies.parseResponse ?? parseAIResponse;
      const payload = parseResponse(rawResponse, { conversationId });
      if (payload.error) throw new Error(payload.error);

      const operations = (payload.operations ?? []) as FileOperation[];
      const plan = dependencies.plan ?? planOperations;
      const previews = await plan(operations, projectRoot);
      return {
        conversationId: payload.conversationId,
        userTask,
        contextRefs: freezeClone(contextRefs),
        contextSummary: freezeClone(context.summary),
        rawResponse,
        operations: freezeClone(operations),
        previews: freezeClone(previews),
      };
    } catch (error) {
      lastError = error;
      const reason = formatUnknownError(error);
      if (attempt >= maxAttempts) {
        throw new AgentPreparationError(
          'INVALID_RESPONSE',
          reason,
          attempt,
          { cause: error },
        );
      }
      await emit(dependencies, {
        type: 'retrying',
        attempt,
        maxAttempts,
        category: 'validation',
        reason,
      });
      const retry = createRetryMessage(
        reason,
        conversationId,
        userTask,
        systemPrompt,
        context.block,
        hasRetriedWithFullSystem,
      );
      message = retry.message;
      hasRetriedWithFullSystem = retry.hasRetriedWithFullSystem;
      includeSystemInstructions = retry.includeSystemInstructions;
    }
  }

  throw new AgentPreparationError(
    'INVALID_RESPONSE',
    formatUnknownError(lastError),
    maxAttempts,
    { cause: lastError },
  );
}

export async function runAskWorkflow(
  input: RunAskWorkflowInput,
  dependencies: AgentPreparationDependencies,
): Promise<AskWorkflowResult> {
  const projectRoot = requireText(input.projectRoot, 'projectRoot');
  const conversationId = requireText(input.conversationId, 'conversationId');
  const parsed = parseAtRefs(requireText(input.prompt, 'prompt'));
  const userPrompt = parsed.cleanPrompt || input.prompt.trim();
  const contextRefs = uniqueText([...(input.contextRefs ?? []), ...parsed.paths]);
  const context = await buildAskContext(
    projectRoot,
    contextRefs,
    input.contextBudget,
    dependencies,
  );

  await emit(dependencies, {
    type: 'context_ready',
    mode: 'ask',
    summary: context.summary,
  });

  const markdownDraft = isMarkdownDraftRequest(userPrompt);
  const systemPrompt = buildAskSystemPrompt({ markdownDraft });
  const message = buildFullMessage('ask', systemPrompt, userPrompt, context.block, {
    includeSystemInstructions: input.includeSystemInstructions ?? true,
  });
  const request: AgentSubmissionRequest = {
    mode: 'ask',
    prompt: userPrompt,
    systemPrompt,
    message,
    conversationId,
    markdownDraft,
    attempt: 1,
    maxAttempts: 1,
  };
  await emit(dependencies, { type: 'submission_started', request });
  const responseText = await dependencies.submitAndWait(request);
  await emit(dependencies, {
    type: 'response_received',
    mode: 'ask',
    attempt: 1,
  });

  return {
    conversationId,
    userPrompt,
    contextRefs: freezeClone(contextRefs),
    contextSummary: freezeClone(context.summary),
    markdownDraft,
    responseText,
  };
}

async function buildAgentContext(
  projectRoot: string,
  contextRefs: string[],
  contextBudget: number | undefined,
  dependencies: AgentPreparationDependencies,
): Promise<{ block: string; summary: PreparationContextSummary }> {
  const generateProjectContext =
    dependencies.generateProjectContext ?? generateContext;
  const readProjectMemory = dependencies.readProjectMemory ?? listProjectMemory;
  const buildContext = dependencies.buildContext ?? buildBudgetedContext;
  const [projectSummary, memoryEntries] = await Promise.all([
    generateProjectContext(projectRoot),
    readProjectMemory(projectRoot),
  ]);
  const memoryBlock = formatProjectMemory(memoryEntries);
  const budgeted = contextRefs.length
    ? await buildContext(projectRoot, contextRefs, {
        totalCharacters: contextBudget,
      })
    : null;
  const budgetedBlock = budgeted ? formatBudgetedContextMarkdown(budgeted) : '';
  const agentFiles = budgeted
    ? budgeted.included.map((item) => ({
        path: item.path,
        language: detectLanguageForPath(item.path),
        content: item.content,
        truncated: item.truncated,
      }))
    : [];
  return {
    block: [
      memoryBlock,
      formatAgentContextJson(agentFiles, projectSummary, []),
      budgetedBlock,
    ]
      .filter(Boolean)
      .join('\n\n'),
    summary: summarizeContext(contextRefs, memoryBlock, budgeted),
  };
}

async function buildAskContext(
  projectRoot: string,
  contextRefs: string[],
  contextBudget: number | undefined,
  dependencies: AgentPreparationDependencies,
): Promise<{ block: string; summary: PreparationContextSummary }> {
  const readProjectMemory = dependencies.readProjectMemory ?? listProjectMemory;
  const buildContext = dependencies.buildContext ?? buildBudgetedContext;
  const memoryBlock = formatProjectMemory(await readProjectMemory(projectRoot));
  const budgeted = contextRefs.length
    ? await buildContext(projectRoot, contextRefs, {
        totalCharacters: contextBudget,
      })
    : null;
  const fileBlock = budgeted ? formatBudgetedContextMarkdown(budgeted) : '';
  return {
    block: [memoryBlock, fileBlock].filter(Boolean).join('\n\n'),
    summary: summarizeContext(contextRefs, memoryBlock, budgeted),
  };
}

function summarizeContext(
  references: string[],
  memoryBlock: string,
  budgeted: Awaited<ReturnType<typeof buildBudgetedContext>> | null,
): PreparationContextSummary {
  return {
    references: [...references],
    includedFiles: budgeted?.included.length ?? 0,
    totalCharacters: budgeted?.totalCharacters ?? 0,
    limitCharacters: budgeted?.limitCharacters ?? 0,
    sensitiveExcluded:
      budgeted?.excluded.filter((item) => item.reason === 'sensitive').length ??
      0,
    memoryAttached: Boolean(memoryBlock),
  };
}

function createRetryMessage(
  reason: string,
  conversationId: string,
  userTask: string,
  systemPrompt: string,
  context: string,
  hasRetriedWithFullSystem: boolean,
): {
  message: string;
  hasRetriedWithFullSystem: boolean;
  includeSystemInstructions: boolean;
} {
  const retryBody = buildAgentCompactRetryMessage(
    reason,
    conversationId,
    userTask,
  );
  const includeSystemInstructions = !hasRetriedWithFullSystem;
  return {
    message: buildFullMessage('agent', systemPrompt, retryBody, context, {
      includeSystemInstructions,
    }),
    hasRetriedWithFullSystem:
      hasRetriedWithFullSystem || includeSystemInstructions,
    includeSystemInstructions,
  };
}

function normalizeAttempts(value: number | undefined): number {
  if (value === undefined) return 3;
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('maxAttempts must be an integer between 1 and 5');
  }
  return value;
}

function requireText(value: string, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function uniqueText(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => String(value).trim()).filter(Boolean)),
  ];
}

async function emit(
  dependencies: AgentPreparationDependencies,
  event: PreparationEvent,
): Promise<void> {
  await dependencies.onEvent?.(freezeClone(event));
}

function freezeClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function detectLanguageForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'bash',
    py: 'python',
  };
  return map[ext] ?? 'text';
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error === undefined || error === null) return 'Unknown preparation error';
  return String(error);
}
