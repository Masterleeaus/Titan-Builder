# Canonical Guidance Skill Migration Design

## Objective

Convert the five remaining built-in guidance fallbacks into canonical Titan skill packages without changing user-visible skill names, stored legacy IDs, profile activation, custom skill behaviour, or runtime permissions.

## Scope

Migrate these legacy IDs:

| Legacy ID | Canonical ID | Package |
|---|---|---|
| `testing` | `titan.guidance.test-driven-development` | `test-driven-development` |
| `security` | `titan.guidance.extension-security` | `extension-security` |
| `architecture` | `titan.guidance.architecture-review` | `architecture-review` |
| `git` | `titan.guidance.git-discipline` | `git-discipline` |
| `performance` | `titan.guidance.browser-performance` | `browser-performance` |

The existing `debugging` migration remains unchanged.

## Architecture

Each migrated skill becomes a package under `browser-extension/skill-library/packages/<package>/` containing a strict `manifest.json` and an `instructions.md` file. The existing generator remains the only source for `browser-extension/src/generated/skill-catalog.js`.

`browser-extension/src/skill-registry.js` will consume only generated canonical skills. The temporary `LEGACY_GUIDANCE_SKILLS` array and the `legacySkills` registry option will be removed. Compatibility remains through each manifest's `aliases` field, so stored IDs and profile skill IDs resolve to canonical IDs before workspace composition.

## Behavioural Requirements

1. `BUILTIN_SKILLS` contains six canonical guidance skills and no short legacy IDs.
2. `resolveBuiltinSkillId()` maps all six legacy IDs to canonical IDs.
3. Built-in profiles continue to activate the same effective skills through alias resolution.
4. Custom skill records remain unchanged and are not rewritten to canonical IDs.
5. A canonical ID or alias may still belong to only one skill.
6. All guidance manifests remain `READ` risk, require no approval, declare no capabilities, and target `cli` plus `extension-sidepanel`.
7. Generated catalog drift remains a verification failure on Linux and Windows.

## Instruction Content

The initial canonical instruction text preserves the intent of the existing fallback definitions while making each package independently understandable:

- Test-Driven Development: define a focused failing test, confirm the expected failure, implement minimally, then run broader checks.
- Extension Security: treat page/model input as untrusted and validate origins, sources, paths, commands, secrets, permissions, and approval boundaries.
- Architecture Review: trace registrations, lifecycle, state ownership, adapters, and tests before structural changes; avoid parallel systems.
- Git Discipline: inspect repository and branch state, keep commits focused, avoid destructive operations, and report exact diff and verification evidence.
- Browser Performance: prefer event-driven bounded work, dispose observers/timers/listeners, and require measurable evidence before optimization claims.

## Data Flow

1. Author edits package manifests and instructions.
2. `scripts/generate-skill-catalog.mjs` discovers packages deterministically.
3. The generated extension catalog embeds validated metadata and instruction text.
4. `createExtensionSkillRegistry()` indexes canonical IDs and aliases.
5. Workspace profile and stored IDs resolve through the registry.
6. Prompt composition receives canonical skill records exactly once.

## Error Handling

- Duplicate canonical IDs or aliases fail registry construction.
- Missing or invalid package assets fail generation and root discovery tests.
- Stale generated catalog fails `pnpm run check:skills`.
- Unknown IDs retain existing behaviour: resolution returns the original value and lookup produces no built-in skill.

## Testing

Tests must prove the migration before fallback removal:

- all five short IDs resolve to their canonical IDs;
- `BUILTIN_SKILLS` contains canonical records and excludes legacy records;
- profile activation yields canonical IDs for debugging, testing, and git;
- generated alias collisions still fail closed;
- root manifest and registry tests discover seven total canonical packages;
- the full repository verification matrix passes on Ubuntu and Windows, including both companion jobs.

## Non-Goals

- No executable runtime changes.
- No new permissions or capabilities.
- No UI redesign.
- No migration of user-created custom skills.
- No changes to the agent-profile catalog.
- No automatic merge into `main`.
