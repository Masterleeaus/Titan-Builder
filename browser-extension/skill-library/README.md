# Titan Builder Skill Library

This directory is the canonical authoring source for production Titan skills.

## Package layout

```text
browser-extension/skill-library/
  packages/
    <skill-package>/
      manifest.json
      instructions.md       # guidance skills only
      fixtures/             # optional package-local fixtures
      README.md              # optional operator documentation
```

Executable handlers remain in their authoritative runtime. A manifest `entrypoint` references the existing module and export; it does not copy implementation code into this directory.

## Current inventory

- Canonical packages: 7
- Canonical guidance skills: 6
- Canonical executable skills: 1
- Temporary legacy guidance fallbacks: 0

The six built-in guidance skills are Systematic Debugging, Test-Driven Development, Extension Security, Architecture Review, Git Discipline, and Browser Performance.

## Identity and compatibility

- Canonical IDs use the `titan.*` namespace.
- Existing short IDs are preserved only through manifest `aliases`.
- A canonical ID or alias may belong to exactly one skill.
- Built-in profiles and stored workspace IDs resolve aliases before prompt composition.
- Custom browser skills remain separate user-owned records and are not rewritten.

## Runtime flow

1. `src/skills/loader.ts` discovers and validates package manifests.
2. `src/skills/registry.ts` builds deterministic canonical and alias indexes.
3. `scripts/generate-skill-catalog.mjs` emits an extension-safe catalog.
4. `browser-extension/src/skill-registry.js` builds the browser registry exclusively from the generated catalog.
5. `browser-extension/src/workspace-library.js` resolves profile and stored IDs before composing prompts.

Run `pnpm run generate:skills` after changing a package. `pnpm run check:skills` fails when the committed extension catalog is stale.
