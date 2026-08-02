import { discoverSkillPackages, type LoadedSkillPackage } from './loader.js';

export interface SkillRegistry {
  list(): readonly LoadedSkillPackage[];
  resolve(idOrAlias: string): LoadedSkillPackage | undefined;
  canonicalId(idOrAlias: string): string | undefined;
}

export function createSkillRegistry(input: readonly LoadedSkillPackage[]): SkillRegistry {
  const skills = [...input].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  const byId = new Map<string, LoadedSkillPackage>();
  const aliases = new Map<string, string>();

  for (const skill of skills) {
    const id = skill.manifest.id;
    if (byId.has(id)) throw new Error(`Duplicate skill ID: ${id}`);
    if (aliases.has(id)) throw new Error(`Skill ID collides with alias: ${id}`);
    byId.set(id, skill);

    for (const alias of skill.manifest.aliases ?? []) {
      if (byId.has(alias)) throw new Error(`Skill alias ${alias} collides with a canonical ID.`);
      const existing = aliases.get(alias);
      if (existing) throw new Error(`Duplicate skill alias ${alias}: ${existing} and ${id}`);
      aliases.set(alias, id);
    }
  }

  const frozen = Object.freeze(skills);
  return Object.freeze({
    list: () => frozen,
    resolve: (idOrAlias: string) => {
      const canonical = byId.has(idOrAlias) ? idOrAlias : aliases.get(idOrAlias);
      return canonical ? byId.get(canonical) : undefined;
    },
    canonicalId: (idOrAlias: string) => {
      if (byId.has(idOrAlias)) return idOrAlias;
      return aliases.get(idOrAlias);
    },
  });
}

export async function loadSkillRegistry(libraryRoot: string): Promise<SkillRegistry> {
  return createSkillRegistry(await discoverSkillPackages(libraryRoot));
}
