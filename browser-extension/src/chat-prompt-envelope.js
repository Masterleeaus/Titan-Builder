export function composeRoutedChatPrompt(input = {}) {
  const request = String(input.request ?? '').trim();
  const prompt = input.prompt || {};
  const body = String(input.body ?? '').trim();
  if (!request) throw new Error('Original user request is required.');
  if (!prompt.id || !prompt.title) throw new Error('Selected prompt identity is required.');
  if (!body) throw new Error('Selected prompt body is required.');

  const route = input.route || {};
  const version = prompt.version ? ` v${prompt.version}` : '';
  const score = Number.isFinite(route.score) ? route.score : 'n/a';
  const margin = Number.isFinite(route.margin) ? route.margin : 'n/a';

  return [
    '# Titan Builder Routed Chat Task',
    '',
    '## Selected Prompt',
    `- ID: ${prompt.id}`,
    `- Name: ${prompt.title}${version}`,
    `- Routing reason: ${route.reason || 'selected'}`,
    `- Routing score: ${score}`,
    `- Routing margin: ${margin}`,
    '',
    '## Original User Request',
    request,
    '',
    '## Chat Application Rules',
    '1. Apply the selected prompt as the procedure for this chat request while preserving the original request and every explicit constraint.',
    '2. Use only the conversation, uploaded files, connected tools, and provider capabilities actually available in this chat.',
    '3. Do not assume a registered local project, repository checkout, filesystem access, shell access, deployment access, or background execution.',
    '4. Resolve variables from the original request and trustworthy chat context. Ask one focused question or return BLOCKED when a required value cannot be resolved.',
    '5. The selected prompt does not grant filesystem, repository-write, shell, deployment, approval, or business-operation authority.',
    '6. Do not claim that repository changes, tests, builds, deployments, messages, invoices, jobs, attendance, or payments occurred without direct evidence from an available tool.',
    '7. Continue the ordinary provider conversation normally after this response; do not impose Work-mode reply or continuation limits.',
    '',
    '## Selected Prompt Specification',
    body,
  ].join('\n');
}
