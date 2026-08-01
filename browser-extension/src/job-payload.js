const SYSTEM_START = '--- OpenBrowser System Instructions ---';
const SYSTEM_END = '--- End System Instructions ---';
const PROFILE_START = '--- OpenBrowser Active Agent Profile ---';
const PROFILE_END = '--- End Agent Profile ---';
const SKILLS_START = '--- OpenBrowser Active Skills ---';
const SKILLS_END = '--- End Active Skills ---';
const DEFAULT_PROMPT_LIMIT = 40_000;
const DEFAULT_PROMPT_FILE_NAME = 'openbrowser-prompt.txt';
const DEFAULT_PROMPT_FILE_NOTE =
  'The full OpenBrowser prompt is attached as openbrowser-prompt.txt. Read the attached file and follow every instruction inside it.';

export function mergeWorkspaceInstructions(existing, workspace) {
  const base = stripWorkspaceBlocks(String(existing ?? '')).trim();
  const active = String(workspace ?? '').trim();
  return [base, active].filter(Boolean).join('\n\n');
}

export function composeOutboundMessage(message, systemPrompt) {
  const body = stripLeadingSystemInstructions(String(message ?? '')).trimStart();
  const instructions = String(systemPrompt ?? '').trim();
  if (!instructions) {
    return body;
  }

  return [
    SYSTEM_START,
    instructions,
    SYSTEM_END,
    '',
    body,
  ].join('\n').trimEnd();
}

export function prepareOutboundJob(job, workspaceInstructions = '') {
  const systemPrompt = mergeWorkspaceInstructions(job?.systemPrompt, workspaceInstructions);
  const promptBody = String(job?.promptBody ?? job?.outboundMessage ?? job?.message ?? '');
  const outboundMessage = composeOutboundMessage(promptBody, systemPrompt);
  const rawLimit = Number(job?.promptInjectionCharLimit ?? DEFAULT_PROMPT_LIMIT);
  const promptInjectionCharLimit = Number.isFinite(rawLimit) && rawLimit >= 0
    ? rawLimit
    : DEFAULT_PROMPT_LIMIT;
  const delivery = outboundMessage.length > promptInjectionCharLimit ? 'file' : 'text';
  const promptFileName = String(job?.promptFileName || DEFAULT_PROMPT_FILE_NAME);
  const promptFileComposerNote = String(job?.promptFileComposerNote || DEFAULT_PROMPT_FILE_NOTE);
  const composerMessage = delivery === 'file' ? promptFileComposerNote : outboundMessage;

  return {
    ...job,
    systemPrompt,
    promptBody,
    outboundMessage,
    promptFileContent: delivery === 'file' ? outboundMessage : undefined,
    promptInjectionCharLimit,
    delivery,
    promptFileName: delivery === 'file' ? promptFileName : undefined,
    promptFileComposerNote,
    composerMessage,
    message: composerMessage,
  };
}

export function selectOutboundMessage(job, _context = {}) {
  return String(job?.outboundMessage ?? job?.promptBody ?? job?.message ?? '');
}

function stripLeadingSystemInstructions(message) {
  const leadingTrimmed = message.trimStart();
  if (!leadingTrimmed.startsWith(SYSTEM_START)) {
    return message;
  }
  const endIndex = leadingTrimmed.indexOf(SYSTEM_END, SYSTEM_START.length);
  if (endIndex < 0) {
    return message;
  }
  return leadingTrimmed.slice(endIndex + SYSTEM_END.length).replace(/^\s*\n?/, '');
}

function stripWorkspaceBlocks(value) {
  return stripDelimitedBlock(
    stripDelimitedBlock(value, PROFILE_START, PROFILE_END),
    SKILLS_START,
    SKILLS_END,
  ).replace(/\n{3,}/g, '\n\n');
}

function stripDelimitedBlock(value, startMarker, endMarker) {
  let output = value;
  while (true) {
    const start = output.indexOf(startMarker);
    if (start < 0) {
      return output;
    }
    const end = output.indexOf(endMarker, start + startMarker.length);
    if (end < 0) {
      return output;
    }
    output = `${output.slice(0, start)}${output.slice(end + endMarker.length)}`;
  }
}
