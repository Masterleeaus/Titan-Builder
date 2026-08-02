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

Executable handlers remain in their authoritative runtime. A manifest `entrypoint` references an approved module and export; it does not copy implementation code into this directory or authorize a dynamic import.

## Current inventory

- Canonical packages: 7
- Canonical guidance skills: 6
- Canonical executable skills: 1
- Runtime-dispatchable executable skills: 1
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
6. `src/skills/dispatcher.ts` resolves executable skills and enforces runtime, capability, approval, input, and output policy.
7. `src/skills/handlers.ts` maps exact approved entrypoints to statically compiled adapters around authoritative implementations.

## Executable skill rules

- Manifests never cause arbitrary module loading. Every executable entrypoint must have an explicit static binding in `src/skills/handlers.ts`.
- Callers must grant every capability declared by the manifest. Risk labels do not imply capability grants.
- `approval: explicit` and `approval: policy` are checked before handler invocation.
- Guidance and orchestration skills cannot enter executable dispatch.
- Input and output values are checked against the manifest object contracts.
- Handler exceptions remain authoritative; policy failures occur before execution.
- The browser extension does not execute root skills. Root execution remains in the Node runtime.

The currently dispatchable executable skill is `titan.security.project-path-containment`, which delegates to the existing `src/security/project-path.ts#resolveProjectPath` implementation.

Run `pnpm run generate:skills` after changing a package. `pnpm run check:skills` fails when the committed extension catalog is stale.
