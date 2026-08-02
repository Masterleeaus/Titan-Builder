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

## Identity and compatibility

- Canonical IDs use the `titan.*` namespace.
- Existing short IDs are preserved through `aliases`.
- A canonical ID or alias may belong to exactly one skill.
- Custom browser skills remain separate user-owned records.

## Runtime flow

1. `src/skills/loader.ts` discovers and validates package manifests.
2. `src/skills/registry.ts` builds deterministic canonical and alias indexes.
3. `scripts/generate-skill-catalog.mjs` emits an extension-safe catalog.
4. `browser-extension/src/skill-registry.js` combines migrated guidance skills with temporary legacy fallbacks.
5. `browser-extension/src/workspace-library.js` resolves profile and stored IDs before composing prompts.

Run `pnpm run generate:skills` after changing a package. `pnpm run check:skills` fails when the committed extension catalog is stale.
