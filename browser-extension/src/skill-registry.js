import { GENERATED_SKILL_CATALOG } from './generated/skill-catalog.js';

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
