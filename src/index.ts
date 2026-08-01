#!/usr/bin/env node
import crypto from 'node:crypto';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { stdout as output } from 'node:process';
import { Command } from 'commander';
import { submitPrompt, waitForSessionResponse } from './client/bridge-client.js';
import { loadOpenBrowserEnvironment } from './config/environment.js';
import type { FileOperation } from './core/types/index.js';
import {
  buildBudgetedContext,
  formatAgentContextJson,
  formatBudgetedContextMarkdown,
  formatContextBudgetPreview,
  generateContext,
  listContextChoices,
  parseAtRefs,
  readBufferedPrompt,
} from './context/index.js';
import { parseAIResponse } from './parser/index.js';
import {
  addProjectMemory,
  clearProjectMemory,
  formatProjectMemory,
  listProjectMemory,
  removeProjectMemory,
} from './memory/project-memory.js';
import {
  getActiveProject,
  listProjects,
  registerProject,
  removeProject,
  resolveProject,
  setActiveProject,
} from './projects/registry.js';
import { executeOperations, planOperations } from './operations/index.js';
import {
  buildAgentSystemPrompt,
  buildAskSystemPrompt,
  buildAgentCompactRetryMessage,
  buildFullMessage,
  isMarkdownDraftRequest,
} from './prompts/system.js';
import { extractMarkdownDraftContent } from './parser/markdown-agent.js';
import { startServer } from './server/index.js';
import { readProjectStatus, type ProjectStatus } from './project/status.js';
import { detectVerificationPlan, parseVerificationProfile } from './verification/index.js';
import {
  PROMPT_FILE_NAME,
  PROMPT_INJECTION_CHAR_LIMIT,
  shouldDeliverPromptAsFile,
} from './shared/prompt-delivery.js';
import {
  AgentStepTracker,
  colors,
  formatError,
  formatModeChoicePrompt,
  formatModePrompt,
  printBanner,
  printModeMenu,
  WaitingSpinner,
  writeAnswerBlock,
  writeAtHint,
  writeDiffBlock,
  writeError,
  writeInfo,
  writeSessionEnd,
  writeSuccess,
  writeWarning,
  type TrackerStep,
} from './shared/index.js';

loadOpenBrowserEnvironment();

const require = createRequire(import.meta.url);
const packageMetadata = require('../package.json') as { version: string };

const program = new Command();
const DEFAULT_PORT = Number(process.env.PORT ?? 5000);

const sessionPrimingState = {
  askPrimed: false,
  agentPrimed: false,
};

interface RunOptions {
  contextPaths?: string[];
  contextBudget?: number;
  interactive?: boolean;
  verificationProfile?: string;
}

program
  .name('openbrowser')
  .description('Local CLI agent for browser-based AI coding assistants')
  .version(packageMetadata.version);

program
  .command('ask')
  .description('Chat with AI and receive Markdown responses in the terminal')
  .argument('<prompt>', 'Question or prompt to send to AI')
  .option('-c, --context <paths...>', 'attach file or folder paths')
  .option('-b, --budget <characters>', 'maximum context characters', parsePositiveInteger)
  .action(async (prompt: string, commandOptions: { context?: string[]; budget?: number }) => {
    await withBridge(async () => {
      printBanner();
      await runAsk(prompt, { contextPaths: commandOptions.context, contextBudget: commandOptions.budget });
    });
  });

program
  .command('agent')
  .description('Run agent mode with file operations and diff preview')
  .argument('<task>', 'Task description for the AI agent')
  .option('-c, --context <paths...>', 'attach file or folder paths')
  .option('-b, --budget <characters>', 'maximum context characters', parsePositiveInteger)
  .option('--verify <profile>', 'run quick, standard, or full verification after applying changes')
  .action(async (task: string, commandOptions: { context?: string[]; budget?: number; verify?: string }) => {
    await withBridge(async () => {
      printBanner();
      await runAgent(task, {
        contextPaths: commandOptions.context,
        contextBudget: commandOptions.budget,
        verificationProfile: commandOptions.verify,
      });
    });
  });

program
  .command('status')
  .description('Show Git and project status without modifying files')
  .action(async () => {
    printBanner();
    const status = await readProjectStatus(process.cwd());
    printProjectStatus(status);
  });

program
  .command('verify')
  .description('Detect and run repository verification scripts')
  .option('-p, --profile <profile>', 'quick, standard, or full verification', 'standard')
  .option('--dry-run', 'show verification commands without running them')
  .action(async (options: { profile: string; dryRun?: boolean }) => {
    printBanner();
    await runVerification(options.profile, options.dryRun === true);
  });


const projectCommand = program.command('project').description('Manage persistent OpenBrowser projects');
projectCommand
  .command('add')
  .argument('[root]', 'project root', '.')
  .option('-n, --name <name>', 'display name')
  .action(async (root: string, options: { name?: string }) => {
    const project = await registerProject(root, { name: options.name });
    await setActiveProject(project.id);
    writeSuccess(`registered ${project.name}`);
    writeInfo(project.root);
  });
projectCommand.command('list').action(async () => {
  printProjects(await listProjects(), await getActiveProject());
});
projectCommand.command('show').argument('[project]', 'project id, name, or path').action(async (identifier?: string) => {
  const project = identifier ? await resolveProject(identifier) : await getActiveProject();
  if (!project) throw new Error('No active project.');
  printProjects([project], await getActiveProject());
});
projectCommand.command('use').argument('<project>', 'project id, name, or path').action(async (identifier: string) => {
  const project = await resolveProject(identifier);
  await setActiveProject(project.id);
  writeSuccess(`active project: ${project.name}`);
  writeInfo(`Run commands from ${project.root} to execute against this project.`);
});
projectCommand.command('remove').argument('<project>', 'project id, name, or path').action(async (identifier: string) => {
  const project = await resolveProject(identifier);
  await removeProject(project.id);
  writeSuccess(`removed ${project.name} from the registry`);
});

const memoryCommand = program.command('memory').description('Manage explicit memory for the current project');
memoryCommand
  .command('add')
  .argument('<text>', 'decision, constraint, or fact')
  .option('-t, --tag <tags...>', 'memory tags')
  .action(async (text: string, options: { tag?: string[] }) => {
    const entry = await addProjectMemory(process.cwd(), text, options.tag ?? []);
    writeSuccess(`saved memory ${entry.id}`);
  });
memoryCommand.command('list').action(async () => {
  const entries = await listProjectMemory(process.cwd());
  if (!entries.length) return writeInfo('No project memory saved.');
  output.write(`
${colors.bold}Project memory${colors.reset}
`);
  for (const entry of entries) output.write(`${entry.id}  ${entry.text}${entry.tags.length ? ` [${entry.tags.join(', ')}]` : ''}
`);
});
memoryCommand.command('remove').argument('<id>', 'memory id').action(async (id: string) => {
  const removed = await removeProjectMemory(process.cwd(), id);
  if (!removed) throw new Error(`Memory not found: ${id}`);
  writeSuccess(`removed ${id}`);
});
memoryCommand.command('clear').action(async () => {
  await clearProjectMemory(process.cwd());
  writeSuccess('cleared project memory');
});

const contextCommand = program.command('context').description('Preview or export budgeted project context');
contextCommand
  .command('preview')
  .argument('[paths...]', 'files or folders', ['.'])
  .option('-b, --budget <characters>', 'total character budget', parsePositiveInteger, 120000)
  .option('--per-file <characters>', 'per-file character cap', parsePositiveInteger, 32000)
  .option('--max-files <count>', 'maximum files', parsePositiveInteger, 30)
  .action(async (paths: string[], options: { budget: number; perFile: number; maxFiles: number }) => {
    const result = await buildBudgetedContext(process.cwd(), paths, {
      totalCharacters: options.budget,
      perFileCharacters: options.perFile,
      maxFiles: options.maxFiles,
    });
    output.write(`
${formatContextBudgetPreview(result)}
`);
  });
contextCommand
  .command('export')
  .argument('<output>', 'Markdown output path')
  .argument('[paths...]', 'files or folders', ['.'])
  .option('-b, --budget <characters>', 'total character budget', parsePositiveInteger, 120000)
  .option('--per-file <characters>', 'per-file character cap', parsePositiveInteger, 32000)
  .option('--max-files <count>', 'maximum files', parsePositiveInteger, 30)
  .action(async (outputPath: string, paths: string[], options: { budget: number; perFile: number; maxFiles: number }) => {
    const result = await buildBudgetedContext(process.cwd(), paths, {
      totalCharacters: options.budget,
      perFileCharacters: options.perFile,
      maxFiles: options.maxFiles,
    });
    const resolvedOutput = path.resolve(process.cwd(), outputPath);
    if (!isPathInside(process.cwd(), resolvedOutput)) throw new Error('Context export must stay inside the current project.');
    await writeFile(resolvedOutput, `${formatContextBudgetPreview(result)}

${formatBudgetedContextMarkdown(result)}
`, 'utf8');
    writeSuccess(`exported context to ${path.relative(process.cwd(), resolvedOutput)}`);
  });

program
  .command('server')
  .description('Run only the local bridge server')
  .action(async () => {
    await startServer({ port: DEFAULT_PORT });
  });

if (process.argv.length <= 2) {
  await withBridge(runInteractive);
} else {
  await program.parseAsync();
}

async function runVerification(rawProfile: string, dryRun: boolean): Promise<void> {
  const profile = parseVerificationProfile(rawProfile);
  const detected = await detectVerificationPlan(process.cwd(), profile);
  if (detected.operations.length === 0) {
    writeWarning(
      `No approved ${profile} verification scripts were found for ${detected.packageManager}.`,
    );
    return;
  }

  const plans = await planOperations(detected.operations, process.cwd());
  output.write(`
${colors.bold}Verification plan${colors.reset} ${colors.dim}(${profile})${colors.reset}
`);
  for (const plan of plans) {
    writeDiffBlock(plan.diff);
  }

  if (dryRun) {
    writeInfo('dry run only; no verification commands executed');
    return;
  }

  await executeOperations(detected.operations, process.cwd(), {
    onStep: (step, detail) => writeInfo(`${step}${detail ? `: ${detail}` : ''}`),
  });
  writeSuccess(`${profile} verification completed`);
}

function printProjectStatus(status: ProjectStatus): void {
  output.write(`\n${colors.bold}Project status${colors.reset}\n`);
  output.write(`${colors.dim}Project:${colors.reset} ${status.projectName}\n`);
  output.write(`${colors.dim}Root:${colors.reset} ${status.repositoryRoot ?? status.projectRoot}\n`);
  output.write(`${colors.dim}Git:${colors.reset} ${status.isGitRepository ? 'yes' : 'no'}\n`);
  output.write(`${colors.dim}Branch:${colors.reset} ${status.branch}\n`);
  output.write(
    `${colors.dim}Working tree:${colors.reset} ${status.dirty ? `${status.changedFiles} changed file(s)` : 'clean'}\n`,
  );
  output.write(`${colors.dim}Package manager:${colors.reset} ${status.packageManager}\n`);
  if (status.remote) {
    output.write(`${colors.dim}Remote:${colors.reset} ${status.remote}\n`);
  }
  if (status.branch === 'main' || status.branch === 'master') {
    writeWarning('You are on the default branch. Create a feature branch before agent edits.');
  }
}

async function withBridge<T>(callback: () => Promise<T>): Promise<T> {
  const server = await startServer({ port: DEFAULT_PORT });
  try {
    return await callback();
  } finally {
    await server.close();
  }
}

async function runInteractive(): Promise<void> {
  printBanner();

  const choices = await listContextChoices(process.cwd());

  while (true) {
    const mode = await chooseMode(choices);
    if (mode === 'exit') {
      writeSessionEnd('goodbye');
      break;
    }

    const { prompt, contextPaths } = await readPromptWithContext(mode, choices);
    if (!prompt && contextPaths.length === 0) {
      continue;
    }

    if (mode === 'ask') {
      await runAsk(prompt, { contextPaths, interactive: true });
    } else {
      await runAgent(prompt, { contextPaths, interactive: true });
    }

    writeSessionEnd(mode === 'ask' ? 'ask session complete' : 'agent session complete');
  }
}

async function chooseMode(
  choices: string[],
): Promise<'ask' | 'agent' | 'exit'> {
  printModeMenu();

  while (true) {
    const answer = (
      await readBufferedPrompt(formatModeChoicePrompt(), { choices })
    ).trim().toLowerCase();
    if (answer === '1' || answer === 'ask') {
      return 'ask';
    }
    if (answer === '2' || answer === 'agent') {
      return 'agent';
    }
    if (answer === 'q' || answer === 'quit' || answer === 'exit') {
      return 'exit';
    }
    writeWarning('Choose 1, 2, or q.');
  }
}

async function readPromptWithContext(
  mode: 'ask' | 'agent',
  choices: string[],
): Promise<{ prompt: string; contextPaths: string[] }> {
  writeAtHint();

  while (true) {
    const line = (await readBufferedPrompt(formatModePrompt(mode), { choices })).trim();

    if (!line) {
      continue;
    }

    const { cleanPrompt, paths: contextPaths } = parseAtRefs(line);
    return { prompt: cleanPrompt || line, contextPaths };
  }
}

async function waitForBrowserResponse(sessionId: string): Promise<string> {
  return waitForSessionResponse(sessionId, {
    port: DEFAULT_PORT,
  });
}


async function runAsk(prompt: string, options: RunOptions = {}): Promise<void> {
  const tracker = new AgentStepTracker();
  const currentProject = await registerProject(process.cwd());
  await setActiveProject(currentProject.id);
  const conversationId = crypto.randomUUID();
  const { cleanPrompt, paths } = parseAtRefs(prompt);
  const contextPaths = [...new Set([...(options.contextPaths ?? []), ...paths])];
  const userPrompt = cleanPrompt || prompt;
  const markdownDraft = isMarkdownDraftRequest(userPrompt);
  const systemPrompt = buildAskSystemPrompt({ markdownDraft });
  const shouldIncludeSystemPrompt = !sessionPrimingState.askPrimed || !options.interactive;

  const memoryBlock = formatProjectMemory(await listProjectMemory(process.cwd()));
  let contextBlock = memoryBlock;
  if (contextPaths.length > 0) {
    tracker.step('reading project', `${contextPaths.length} context reference(s)`);
    const budgeted = await buildBudgetedContext(process.cwd(), contextPaths, {
      totalCharacters: options.contextBudget,
    });
    const fileBlock = formatBudgetedContextMarkdown(budgeted);
    contextBlock = [memoryBlock, fileBlock].filter(Boolean).join('\n\n');
    if (budgeted.included.length === 0) {
      writeWarning(
        `@ references [${contextPaths.join(', ')}] matched no safe text files. Use Tab after @ to complete paths.`,
      );
    } else {
      writeInfo(`attached ${budgeted.included.length} file(s) using ${budgeted.totalCharacters}/${budgeted.limitCharacters} context characters`);
      const sensitiveCount = budgeted.excluded.filter((item) => item.reason === 'sensitive').length;
      if (sensitiveCount > 0) writeInfo(`excluded ${sensitiveCount} sensitive path(s)`);
    }
  } else if (memoryBlock) {
    writeInfo('attached explicit project memory');
  }

  const message = buildFullMessage('ask', systemPrompt, userPrompt, contextBlock, {
    includeSystemInstructions: shouldIncludeSystemPrompt,
  });

  tracker.step('reading browser', markdownDraft ? 'sending markdown draft' : 'sending prompt');
  writeInfo('sending to browser AI (open ChatGPT with the extension loaded)');
  if (shouldDeliverPromptAsFile(message)) {
    writeInfo(
      `prompt exceeds ${PROMPT_INJECTION_CHAR_LIMIT} chars — attaching ${PROMPT_FILE_NAME} instead of pasting`,
    );
  }
  if (markdownDraft) {
    writeInfo('draft mode: AI will return a markdown block for you to copy');
  }

  const spinner = new WaitingSpinner();
  spinner.start('waiting for response');

  const { sessionId } = await submitPrompt({
    mode: 'ask',
    prompt: userPrompt,
    systemPrompt,
    message,
    conversationId,
    markdownDraft,
  });

  try {
    const answer = await waitForBrowserResponse(sessionId);
    spinner.stop();
    sessionPrimingState.askPrimed = true;

    tracker.complete(markdownDraft ? 'markdown draft received' : 'response received');
    writeAnswerBlock(answer || '(empty response)');

    if (markdownDraft && answer?.trim()) {
      const draft = extractMarkdownDraftContent(answer);
      if (draft && draft.length > 0) {
        output.write(`\n${colors.dim}--- Markdown draft (copy below) ---${colors.reset}\n\n`);
        output.write(draft);
        output.write(`\n\n${colors.dim}--- End draft ---${colors.reset}\n`);
      } else {
        writeWarning('Could not extract markdown draft. Copy the markdown block from the browser.');
      }
      writeInfo('to create the file in your project, switch to agent mode and say: create README.md');
    }
  } catch (error) {
    spinner.stop();
    writeError(`Ask error: ${formatError(error)}`);
  } finally {
    if (!options.interactive) {
      writeSessionEnd('ask session complete');
    }
  }
}

async function runAgent(task: string, options: RunOptions = {}): Promise<void> {
  const tracker = new AgentStepTracker();
  const currentProject = await registerProject(process.cwd());
  await setActiveProject(currentProject.id);
  tracker.step('reading project', process.cwd());

  const { cleanPrompt, paths } = parseAtRefs(task);
  const contextPaths = [...new Set([...(options.contextPaths ?? []), ...paths])];
  const userTask = cleanPrompt || task;

  const projectSummary = await generateContext(process.cwd());
  const budgeted =
    contextPaths.length > 0
      ? await buildBudgetedContext(process.cwd(), contextPaths, {
          totalCharacters: options.contextBudget,
        })
      : null;
  const memoryBlock = formatProjectMemory(await listProjectMemory(process.cwd()));
  const budgetedBlock = budgeted ? formatBudgetedContextMarkdown(budgeted) : '';
  const context = [
    memoryBlock,
    formatAgentContextJson([], projectSummary, []),
    budgetedBlock,
  ].filter(Boolean).join('\n\n');

  if (budgeted?.included.length) {
    writeInfo(
      `attached ${budgeted.included.length} file(s) using ${budgeted.totalCharacters}/${budgeted.limitCharacters} context characters`,
    );
  } else if (contextPaths.length > 0) {
    writeWarning(
      `@ references [${contextPaths.join(', ')}] matched no safe text files. Use Tab after @ to complete paths.`,
    );
  }
  if (memoryBlock) writeInfo('attached explicit project memory');

  const conversationId = crypto.randomUUID();
  const systemPrompt = buildAgentSystemPrompt(conversationId);
  let hasRetriedWithFullSystem = false;
  let message = buildFullMessage('agent', systemPrompt, userTask, context, {
    includeSystemInstructions: !sessionPrimingState.agentPrimed || !options.interactive,
  });

  const maxAttempts = 3;
  let raw = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    tracker.step('reading browser', `attempt ${attempt}/${maxAttempts}`);
    writeInfo('sending to browser AI (open ChatGPT with the extension loaded)');
    if (shouldDeliverPromptAsFile(message)) {
      writeInfo(
        `prompt exceeds ${PROMPT_INJECTION_CHAR_LIMIT} chars — attaching ${PROMPT_FILE_NAME} instead of pasting`,
      );
    }

    const spinner = new WaitingSpinner();
    spinner.start('waiting for agent response');

    const { sessionId } = await submitPrompt({
      mode: 'agent',
      prompt: userTask,
      systemPrompt,
      message,
      conversationId,
    });

    try {
      raw = await waitForBrowserResponse(sessionId);
      spinner.stop();
    } catch (error) {
      spinner.stop();
      const captureError = formatError(error);
      if (attempt >= maxAttempts) {
        writeError(`Agent error: ${captureError}`);
        return;
      }

      writeWarning(`Browser capture failed (${captureError}). Retrying...`);
      const retryBody = buildAgentCompactRetryMessage(captureError, conversationId, userTask);
      const includeSystem = !hasRetriedWithFullSystem;
      message = buildFullMessage('agent', systemPrompt, retryBody, context, {
        includeSystemInstructions: includeSystem,
      });
      if (includeSystem) {
        hasRetriedWithFullSystem = true;
      }
      continue;
    }

    if (!raw.trim()) {
      if (attempt >= maxAttempts) {
        tracker.complete('no operations received');
        return;
      }

      writeWarning('Empty browser response. Retrying...');
      const retryBody = buildAgentCompactRetryMessage(
        'Empty response from browser AI',
        conversationId,
        userTask,
      );
      const includeSystem = !hasRetriedWithFullSystem;
      message = buildFullMessage('agent', systemPrompt, retryBody, context, {
        includeSystemInstructions: includeSystem,
      });
      if (includeSystem) {
        hasRetriedWithFullSystem = true;
      }
      continue;
    }

    try {
      tracker.step('loading', 'validating AI response');
      const payload = parseAIResponse(raw, { conversationId });
      if (payload.error) {
        throw new Error(payload.error);
      }

      const operations = (payload.operations ?? []) as FileOperation[];
      const hasMarkdownCreate = operations.some(
        (op) => op.action === 'CREATE_FILE' && /\.md$/i.test(op.path ?? ''),
      );

      const plans = await planOperations(operations, process.cwd());

      output.write(`
${colors.bold}Changes preview${colors.reset} ${colors.dim}(${plans.length} operation(s))${colors.reset}
`);
      writeRiskSummary(plans);
      for (const plan of plans) {
        writeDiffBlock(plan.diff);
      }

      const approvedOperations: typeof operations = [];
      for (const plan of plans) {
        if (plan.risk !== 'DESTRUCTIVE' && plan.risk !== 'PUBLISH') {
          approvedOperations.push(plan.operation);
          continue;
        }

        const firstLine = plan.diff.split(/\r?\n/, 1)[0] ?? plan.operation.action;
        const approvedRisk = await confirm(`Approve ${plan.risk} operation: ${firstLine}?`);
        if (approvedRisk) {
          approvedOperations.push(plan.operation);
        } else {
          writeWarning(`skipped ${plan.operation.action}`);
        }
      }

      if (approvedOperations.length === 0) {
        tracker.complete('rejected');
        writeWarning('no operations approved');
        return;
      }

      const approved = await confirm(`Apply ${approvedOperations.length} approved operation(s)?`);
      if (!approved) {
        tracker.complete('rejected');
        writeWarning('changes not applied');
        return;
      }

      if (hasMarkdownCreate) {
        writeInfo('README/.md content captured from a markdown block in the browser');
      }

      try {
        await executeOperations(approvedOperations, process.cwd(), {
          conversationId: payload.conversationId,
          onStep: (step, detail) => tracker.step(step as TrackerStep, detail),
        });
      } catch (error) {
        tracker.complete('execution failed');
        writeError(`Operation execution failed: ${formatError(error)}`);
        writeWarning('The AI response will not be retried automatically after an execution failure. Review the working tree before continuing.');
        return;
      }

      writeSuccess(`applied ${approvedOperations.length} operation(s)`);

      if (options.verificationProfile) {
        try {
          await runVerification(options.verificationProfile, false);
        } catch (error) {
          tracker.complete('verification failed');
          writeError(`Post-change verification failed: ${formatError(error)}`);
          writeWarning('Changes remain in the working tree for inspection; the AI response was not regenerated or reapplied.');
          return;
        }
      }

      const finalStatus = await readProjectStatus(process.cwd());
      writeInfo(
        `working tree after pass: ${finalStatus.dirty ? `${finalStatus.changedFiles} changed file(s)` : 'clean'}`,
      );
      tracker.complete(`applied ${approvedOperations.length} operation(s)`);
      sessionPrimingState.agentPrimed = true;
      return;
    } catch (error) {
      const validationError = formatError(error);
      if (attempt >= maxAttempts) {
        writeError(`Agent error: ${validationError}`);
        return;
      }

      writeWarning(`Invalid agent response (${validationError}). Retrying (${attempt}/${maxAttempts - 1})...`);
      const retryBody = buildAgentCompactRetryMessage(validationError, conversationId, userTask);
      const includeSystem = !hasRetriedWithFullSystem;
      message = buildFullMessage('agent', systemPrompt, retryBody, context, {
        includeSystemInstructions: includeSystem,
      });
      if (includeSystem) {
        hasRetriedWithFullSystem = true;
      }
    }
  }

  if (!options.interactive) {
    writeSessionEnd('agent session complete');
  }
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, received: ${value}`);
  }
  return Math.round(parsed);
}

function printProjects(projects: Awaited<ReturnType<typeof listProjects>>, active: Awaited<ReturnType<typeof getActiveProject>>): void {
  if (!projects.length) {
    writeInfo('No registered projects. Use: openbrowser project add .');
    return;
  }
  output.write(`\n${colors.bold}Registered projects${colors.reset}\n`);
  for (const project of projects) {
    const marker = active?.id === project.id ? '*' : ' ';
    output.write(`${marker} ${project.id}  ${project.name}\n  ${project.root}\n`);
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function writeRiskSummary(plans: Awaited<ReturnType<typeof planOperations>>): void {
  const counts = new Map<string, number>();
  for (const plan of plans) {
    counts.set(plan.risk, (counts.get(plan.risk) ?? 0) + 1);
  }

  const order = ['READ', 'SAFE_EXECUTION', 'WRITE', 'DESTRUCTIVE', 'PUBLISH'];
  const summary = order
    .filter((risk) => counts.has(risk))
    .map((risk) => `${risk}:${counts.get(risk)}`)
    .join(' · ');
  writeInfo(`risk summary ${summary || 'none'}`);
}

async function confirm(question: string): Promise<boolean> {
  const prompt = `${colors.yellow}?${colors.reset} ${question} ${colors.dim}[y/N]${colors.reset} `;
  const answer = (await readBufferedPrompt(prompt)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}
