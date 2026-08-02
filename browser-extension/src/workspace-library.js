const uniqueStrings = (value) => {
  const source = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))];
};

const createId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const BUILTIN_SKILLS = Object.freeze([
  {
    id: 'debugging',
    title: 'Systematic Debugging',
    description: 'Trace evidence and isolate root cause before editing.',
    instructions: 'Reproduce or trace the defect, identify the root cause, then make the smallest coherent fix.',
    tags: ['debugging', 'root-cause'],
    custom: false,
  },
  {
    id: 'testing',
    title: 'Test-Driven Development',
    description: 'Write focused regression tests before implementation.',
    instructions: 'Define the expected behaviour with a focused failing test, implement minimally, then run the relevant broader checks.',
    tags: ['tests', 'tdd'],
    custom: false,
  },
  {
    id: 'security',
    title: 'Extension Security',
    description: 'Review browser, bridge, filesystem, and execution trust boundaries.',
    instructions: 'Treat page content and model output as untrusted. Validate origins, message sources, paths, commands, secrets, and permissions.',
    tags: ['security', 'manifest-v3'],
    custom: false,
  },
  {
    id: 'architecture',
    title: 'Architecture Review',
    description: 'Preserve existing boundaries and avoid duplicate runtimes.',
    instructions: 'Trace existing registrations, lifecycle, state ownership, platform adapters, and tests before proposing structural changes.',
    tags: ['architecture', 'refactor'],
    custom: false,
  },
  {
    id: 'git',
    title: 'Git Discipline',
    description: 'Keep changes reviewable and branch-safe.',
    instructions: 'Inspect repository status first, keep changes focused, avoid destructive Git commands, and report the exact diff and verification evidence.',
    tags: ['git', 'review'],
    custom: false,
  },
  {
    id: 'performance',
    title: 'Browser Performance',
    description: 'Find expensive observers, timers, rendering, and service-worker churn.',
    instructions: 'Prefer event-driven behaviour, bounded work, cleanup on disposal, and measurable performance evidence.',
    tags: ['performance', 'browser'],
    custom: false,
  },
]);

export const BUILTIN_AGENT_PROFILES = Object.freeze([
  {
    id: 'coding-agent',
    name: 'Coding Agent',
    role: 'Implementation',
    instructions: 'Inspect the current implementation, make focused changes, and verify them with real tests or builds.',
    skillIds: ['debugging', 'testing', 'git'],
    custom: false,
  },
  {
    id: 'extension-auditor',
    name: 'Extension Auditor',
    role: 'Audit and security review',
    instructions: 'Trace the full browser-extension runtime and classify confirmed defects separately from risks and test gaps.',
    skillIds: ['security', 'architecture', 'performance'],
    custom: false,
  },
  {
    id: 'test-engineer',
    name: 'Test Engineer',
    role: 'Quality and regression prevention',
    instructions: 'Prioritise reproducible failures, focused tests, deterministic checks, and honest reporting of unverified areas.',
    skillIds: ['testing', 'debugging'],
    custom: false,
  },
  {
    id: 'release-reviewer',
    name: 'Release Reviewer',
    role: 'Final review',
    instructions: 'Review the complete diff, security boundaries, compatibility, documentation, packaging, and verification evidence before release.',
    skillIds: ['security', 'git', 'architecture'],
    custom: false,
  },
]);

export function normalizeSkill(input = {}, idFactory = () => createId('skill')) {
  const title = String(input.title ?? '').trim();
  const instructions = String(input.instructions ?? '').trim();
  if (!title) throw new Error('Skill title is required.');
  if (!instructions) throw new Error('Skill instructions are required.');
  return {
    id: String(input.id ?? '').trim() || idFactory(),
    title,
    description: String(input.description ?? '').trim(),
    instructions,
    tags: uniqueStrings(input.tags),
    custom: input.custom !== false,
  };
}

export function normalizeAgentProfile(input = {}, idFactory = () => createId('agent')) {
  const name = String(input.name ?? '').trim();
  const instructions = String(input.instructions ?? '').trim();
  if (!name) throw new Error('Agent profile name is required.');
  if (!instructions) throw new Error('Agent profile instructions are required.');
  return {
    id: String(input.id ?? '').trim() || idFactory(),
    name,
    role: String(input.role ?? '').trim(),
    instructions,
    skillIds: uniqueStrings(input.skillIds),
    custom: input.custom !== false,
  };
}

export function resolveWorkspaceContext({
  skills = [],
  profiles = [],
  activeSkillIds = [],
  activeProfileId = '',
} = {}) {
  const skillMap = new Map(skills.map((item) => [item.id, item]));
  const profile = profiles.find((item) => item.id === activeProfileId) ?? null;
  const ids = uniqueStrings([...(profile?.skillIds ?? []), ...activeSkillIds]);
  return {
    profile,
    skills: ids.map((id) => skillMap.get(id)).filter(Boolean),
  };
}

export function composeWorkspacePrompt(prompt, context = {}) {
  const body = String(prompt ?? '').trim();
  const sections = [];
  if (context.profile) {
    sections.push(
      '--- OpenBrowser Active Agent Profile ---',
      `Name: ${context.profile.name}`,
      context.profile.role ? `Role: ${context.profile.role}` : '',
      context.profile.instructions,
      '--- End Agent Profile ---',
    );
  }
  if (context.skills?.length) {
    sections.push(
      '--- OpenBrowser Active Skills ---',
      ...context.skills.map((skill) => `### ${skill.title}\n${skill.instructions}`),
      '--- End Active Skills ---',
    );
  }
  return [...sections.filter(Boolean), body].filter(Boolean).join('\n\n');
}
