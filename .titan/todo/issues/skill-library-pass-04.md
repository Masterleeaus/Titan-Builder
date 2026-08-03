# Titan Skill Library Pass 04

## Objective

Make canonical executable skills callable through a closed root-runtime dispatcher that enforces manifest policy before invoking compiled code.

## Delivered

- Static executable handler registry keyed by exact approved manifest entrypoints.
- No dynamic imports or manifest-selected arbitrary modules.
- Manifest-driven executable dispatch through canonical IDs and aliases.
- Runtime-target enforcement.
- Explicit capability-grant subset enforcement.
- Explicit and policy approval enforcement before handler invocation.
- Additional fail-closed approval protection for high-side-effect risks.
- Focused input and output object-contract validation.
- Stable `SkillDispatchError` codes and issue details.
- Runtime adapter for `titan.security.project-path-containment` delegating to the authoritative `resolveProjectPath` implementation.
- Public exports from `src/skills/index.ts`.
- Ten dispatcher tests covering success, aliases, policy failures, invalid contracts, unknown handlers, and traversal rejection.
- Updated library authoring and runtime documentation.

## Red-Green Evidence

The red contract failed after all existing tests passed with:

```text
ERR_MODULE_NOT_FOUND: Cannot find module 'src/skills/dispatcher.js'
```

The implemented runtime then passed the complete Ubuntu and Windows root workflows, including the skill tests and companion reruns.

## Current Production Inventory

- Canonical packages: 7
- Canonical guidance skills: 6
- Canonical executable skills: 1
- Runtime-dispatchable executable skills: 1
- Temporary legacy guidance fallbacks: 0

## Security Boundary

- Manifests provide identity and policy, not code-loading authority.
- Exact entrypoints must be registered in the compiled handler registry.
- All capability, runtime, approval, and input checks complete before invocation.
- Root execution remains outside the browser extension.
- The tool-library work in PR #18 is not modified or duplicated.

## Next Pass

Extract a first batch of low-risk existing root functions into canonical executable skill packages using the same static binding and dispatch policy. Prioritize read-only project, Git, repository-inspection, and context capabilities that already have authoritative implementations and tests.
