# Titan Builder Skill Library

This directory is the canonical authoring boundary for standalone Titan Builder skills.

The initial foundation defines the manifest contract only. No runtime catalog loader or installer is enabled yet, and the example manifests are not automatically visible in the browser extension.

## Contract ownership

- Runtime types and validation: `src/skills/manifest.ts`
- Machine-readable JSON Schema: `src/skills/titan-skill-manifest.schema.json`
- Public exports: `src/skills/index.ts`
- Positive examples: `browser-extension/skill-library/examples/`
- Negative fixtures: `browser-extension/skill-library/fixtures/invalid/`

The JSON Schema is imported by the runtime validator and is emitted into `dist/skills/` during the TypeScript build. This keeps one checked-in schema contract rather than separate browser and root copies.

## Supported skill kinds

| Kind | Purpose | Required behavior |
|---|---|---|
| `guidance` | Prompt instructions that influence reasoning or workflow. | Requires `instructions`; cannot declare an entrypoint or capabilities; uses `READ` risk and `none` approval. |
| `executable` | One callable capability with typed inputs and outputs. | Requires `entrypoint` in `path#export` form. |
| `orchestration` | A workflow that composes other skills. | Requires `entrypoint`; dependencies must use stable Titan skill IDs. |
| `adapter` | A platform-specific bridge to a provider, browser surface, hook, or external runtime. | Requires `entrypoint` and explicit runtime targets. |

## Stable identifiers

Canonical IDs use:

```text
titan.<category>.<name>
```

Examples:

```text
titan.guidance.systematic-debugging
titan.security.project-path-containment
```

Existing built-in IDs such as `debugging` remain compatibility aliases. They must not become a second canonical registry.

## Risk and approval

The manifest reuses Titan Builder's existing risk vocabulary:

- `READ`
- `SAFE_EXECUTION`
- `WRITE`
- `NETWORK_WRITE`
- `ARBITRARY_EXECUTION`
- `DESTRUCTIVE`
- `PUBLISH`

`NETWORK_WRITE`, `ARBITRARY_EXECUTION`, `DESTRUCTIVE`, and `PUBLISH` require `explicit` or `policy` approval. A manifest cannot lower that requirement.

## Package layout

A future production skill package should use:

```text
browser-extension/skill-library/<category>/<skill-name>/
├── manifest.json
├── README.md
├── instructions.md        # guidance skills only
├── fixtures/
└── examples/
```

Executable handlers remain in their owning runtime. The manifest `entrypoint` references the authoritative implementation rather than copying source code into the library.

## Current examples

- `examples/systematic-debugging/manifest.json` demonstrates migration of the current `debugging` guidance skill through an alias.
- `examples/project-path-containment/manifest.json` demonstrates wrapping the existing secure path resolver as an executable skill.

## Validation

Run the focused contract test:

```bash
node --experimental-strip-types --test src/skills/manifest.test.ts
```

The root verification pipeline includes this test through `pnpm run test:node`.

## Non-goals of this pass

This foundation does not yet provide:

- catalog discovery;
- dependency resolution;
- handler loading;
- activation or deactivation;
- installation or remote packages;
- sandboxing;
- migration of the six existing built-in skill records;
- side-panel rendering from manifests.

Those features depend on this contract and should be implemented in later roadmap passes.
