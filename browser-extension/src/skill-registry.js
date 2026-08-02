import { GENERATED_SKILL_CATALOG } from './generated/skill-catalog.js';

const LEGACY_GUIDANCE_SKILLS = Object.freeze([
  {
    id: 'testing',
    title: 'Test-Driven Development',
    description: 'Write focused regression tests before implementation.',
    instructions: 'Define the expected behaviour with a focused failing test, implement minimally, then run the relevant broader checks.',
    tags: ['tests', 'tdd'],
    kind: 'guidance',
    custom: false,
  },
  {
    id: 'security',
    title: 'Extension Security',
    description: 'Review browser, bridge, filesystem, and execution trust boundaries.',
    instructions: 'Treat page content and model output as untrusted. Validate origins, message sources, paths, commands, secrets, and permissions.',
    tags: ['security', 'manifest-v3'],
    kind: 'guidance',
    custom: false,
  },
  {
    id: 'architecture',
    title: 'Architecture Review',
    description: 'Preserve existing boundaries and avoid duplicate runtimes.',
    instructions: 'Trace existing registrations, lifecycle, state ownership, platform adapters, and tests before proposing structural changes.',
    tags: ['architecture', 'refactor'],
    kind: 'guidance',
    custom: false,
  },
  {
    id: 'git',
    title: 'Git Discipline',
    description: 'Keep changes reviewable and branch-safe.',
    instructions: 'Inspect repository status first, keep changes focused, avoid destructive Git commands, and report the exact diff and verification evidence.',
    tags: ['git', 'review'],
    kind: 'guidance',
    custom: false,
  },
  {
    id: 'performance',
    title: 'Browser Performance',
    description: 'Find expensive observers, timers, rendering, and service-worker churn.',
    instructions: 'Prefer event-driven behaviour, bounded work, cleanup on disposal, and measurable performance evidence.',
    tags: ['performance', 'browser'],
    kind: 'guidance',
    custom: false,
  },
]);

function normalizeGeneratedSkill(record) {
  const manifest = record?.manifest ?? record ?? {};
  return Object.freeze({
    id: String(manifest.id ?? '').trim(),
    title: String(manifest.name ?? manifest.title ?? '').trim(),
    description: String(manifest.description ?? '').trim(),
    instructions: String(record?.instructions ?? manifest.instructionsText ?? manifest.instructions ?? '').trim(),
    tags: Array.isArray(manifest.tags) ? [...manifest.tags] : [],
    aliases: Array.isArray(manifest.aliases) ? [...manifest.aliases] : [],
    kind: String(manifest.kind ?? 'guidance'),
    version: String(manifest.version ?? ''),
    runtimeTargets: Array.isArray(manifest.runtimeTargets) ? [...manifest.runtimeTargets] : [],
    custom: false,
  });
}

export function createExtensionSkillRegistry({
  generatedSkills = GENERATED_SKILL_CATALOG,
  legacySkills = LEGACY_GUIDANCE_SKILLS,
} = {}) {
  const all = [];
  const byId = new Map();
  const aliases = new Map();

  const add = (skill, aliasList = []) => {
    if (!skill.id) throw new Error('Skill ID is required.');
    if (byId.has(skill.id)) throw new Error(`Duplicate skill ID: ${skill.id}`);
    if (aliases.has(skill.id)) throw new Error(`Skill ID collides with alias: ${skill.id}`);
    byId.set(skill.id, skill);
    all.push(skill);
    for (const alias of aliasList) {
      if (byId.has(alias)) throw new Error(`Skill alias ${alias} collides with a canonical ID.`);
      const existing = aliases.get(alias);
      if (existing) throw new Error(`Duplicate skill alias ${alias}: ${existing} and ${skill.id}`);
      aliases.set(alias, skill.id);
    }
  };

  for (const record of generatedSkills) {
    const skill = normalizeGeneratedSkill(record);
    add(skill, skill.aliases);
  }
  for (const legacy of legacySkills) add(Object.freeze({ ...legacy }), []);

  all.sort((left, right) => left.id.localeCompare(right.id));
  const promptSkills = Object.freeze(all.filter((skill) => skill.kind === 'guidance' && skill.instructions));
  const frozenAll = Object.freeze(all);

  return Object.freeze({
    all: frozenAll,
    promptSkills,
    resolveId(idOrAlias) {
      const value = String(idOrAlias ?? '').trim();
      if (byId.has(value)) return value;
      return aliases.get(value) ?? value;
    },
    resolve(idOrAlias) {
      const canonical = this.resolveId(idOrAlias);
      return byId.get(canonical);
    },
  });
}

export const EXTENSION_SKILL_REGISTRY = createExtensionSkillRegistry();
export const BUILTIN_SKILLS = EXTENSION_SKILL_REGISTRY.promptSkills;
export const ALL_BUILTIN_SKILLS = EXTENSION_SKILL_REGISTRY.all;
export const resolveBuiltinSkillId = (idOrAlias) => EXTENSION_SKILL_REGISTRY.resolveId(idOrAlias);
