# Titan Skill Manifest Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one versioned, machine-readable manifest contract for Titan Builder guidance, executable, orchestration, and adapter skills.

**Architecture:** Keep the schema and runtime validator in the authoritative root TypeScript runtime under `src/skills/`. Store standalone examples and invalid fixtures under the browser extension's canonical skill authoring boundary. Preserve legacy built-in skill IDs through aliases and reuse the existing risk and approval vocabulary.

**Tech Stack:** TypeScript 5.7+, Node.js 22 `node:test`, JSON Schema Draft 2020-12, existing root build and verification scripts.

## Global Constraints

- Do not modify `main` directly.
- Do not introduce a second runtime registry or duplicate schema file.
- Do not add dependencies.
- Preserve current built-in skill IDs through aliases.
- Require approval for network write, arbitrary execution, destructive, and publish risks.
- Keep executable handlers in their current owning runtime.

---

### Task 1: Define the manifest contract

**Files:**
- Create: `src/skills/titan-skill-manifest.schema.json`
- Create: `src/skills/manifest.ts`
- Create: `src/skills/index.ts`

**Interfaces:**
- Produces: `TitanSkillManifest`, `validateSkillManifest(value)`, `parseSkillManifest(value)`, and `TITAN_SKILL_MANIFEST_JSON_SCHEMA`.

- [x] Write failing tests for valid guidance and executable manifests.
- [x] Verify the test fails because the manifest module does not exist.
- [x] Implement the schema, types, validation result, and structured validation error.
- [x] Enforce kind-specific entrypoint and instruction rules.
- [x] Enforce stable IDs, semantic versions, unique arrays, and unknown-field rejection.
- [x] Enforce existing Titan risk and approval rules.
- [x] Run the focused tests and TypeScript compiler.

### Task 2: Add fixtures and authoring documentation

**Files:**
- Create: `browser-extension/skill-library/README.md`
- Create: `browser-extension/skill-library/examples/systematic-debugging/manifest.json`
- Create: `browser-extension/skill-library/examples/project-path-containment/manifest.json`
- Create: `browser-extension/skill-library/fixtures/invalid/executable-without-entrypoint.json`
- Create: `browser-extension/skill-library/fixtures/invalid/high-risk-without-approval.json`

**Interfaces:**
- Consumes: the manifest schema from Task 1.
- Produces: positive migration examples and deterministic negative fixtures.

- [x] Add one guidance example with the legacy `debugging` alias.
- [x] Add one executable example for the existing secure path resolver.
- [x] Add invalid entrypoint and approval fixtures.
- [x] Validate positive and negative fixtures with JSON Schema Draft 2020-12.
- [x] Document package ownership, identifiers, kinds, risk, approval, and non-goals.

### Task 3: Wire verification

**Files:**
- Create: `src/skills/manifest.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: validator, schema, examples, and invalid fixtures.
- Produces: a root verification gate for future skill manifests.

- [x] Test positive guidance and executable manifests.
- [x] Test missing entrypoint, high-risk approval, self-dependency, duplicate alias, and unknown-field failures.
- [x] Confirm the runtime exports the checked-in JSON Schema.
- [x] Add the focused test to `test:node`.
- [x] Run focused tests and strict TypeScript compilation.

## Completion Evidence

- Initial test failed with `ERR_MODULE_NOT_FOUND` for `src/skills/manifest.ts`.
- Focused test result after implementation: 7 passed, 0 failed.
- Strict TypeScript compilation result: passed.
- JSON Schema validation: two positive examples valid; two negative fixtures rejected as expected.
