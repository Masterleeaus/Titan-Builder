# Titan Builder Prompt Library Pass 01 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Establish the canonical standalone Markdown prompt-library location and publish the first production-ready prompt document.

**Architecture:** Keep root `src/` focused on the TypeScript CLI/server runtime. Store canonical prompt documents under `browser-extension/prompt-library/`, beside the extension product but outside executable `browser-extension/src/` code. Preserve the current JavaScript prompt cards until a dedicated loader migration is implemented.

**Tech Stack:** Markdown, GitHub, Chrome Manifest V3 repository conventions, existing vanilla JavaScript prompt utilities, Titan Builder metadata standards.

## Global Constraints

- Work only on `feature/prompt-library-pass-01` until the pass is verified.
- Never modify `main` directly.
- Preserve existing root CLI/server and browser-extension runtime behaviour.
- Create exactly one new prompt document in this pass.
- Do not duplicate existing built-in prompt cards.
- Keep all configurable values parameterised.
- Merge the pass back into `main` only after repository review.

---

### Task 1: Repository architecture discovery

**Files:**
- Inspect: `package.json`
- Inspect: `src/prompts/system.ts`
- Inspect: `src/context/prompt-input.ts`
- Inspect: `browser-extension/manifest.json`
- Inspect: `browser-extension/src/coding-prompts.js`
- Inspect: `browser-extension/src/prompt-library.js`
- Inspect: `browser-extension/src/workspace-library.js`
- Inspect: `browser-extension/src/sidepanel.html`
- Inspect: `docs/superpowers/plans/2026-07-31-coding-sidepanel-prompts.md`

**Interfaces:**
- Consumes: current repository structure and runtime ownership.
- Produces: evidence-backed placement decision for prompt documents.

- [x] Confirm root `src/` is the Node.js and TypeScript CLI/server runtime.
- [x] Confirm extension prompt, skill, and agent runtime ownership under `browser-extension/src/`.
- [x] Search for existing standalone Markdown prompt libraries and confirm none exists.
- [x] Record the placement decision in the architecture design.

### Task 2: Cumulative prompt roadmap

**Files:**
- Create: `.titan/todo/issues/Titan-Builder-Prompt-Library-Roadmap.md`

**Interfaces:**
- Consumes: architecture findings and existing built-in prompt inventory.
- Produces: ordered, versioned catalog of planned prompt assets and duplicate-handling decisions.

- [x] Catalogue existing built-in prompt cards.
- [x] Define the complete planned prompt set.
- [x] Assign stable IDs, categories, priorities, statuses, and dependency relationships.
- [x] Mark overlapping existing cards for upgrade or supersession rather than duplication.
- [x] Record pass 01 branch and merge requirements.

### Task 3: First standalone prompt

**Files:**
- Create: `browser-extension/prompt-library/foundation/tb-prompt-found-001-repository-architecture-discovery.md`

**Interfaces:**
- Consumes: `${repository}`, `${branch}`, `${scope}`, `${asset_type}`, `${candidate_paths}`, `${output_path}`, `${provider}`, `${validation_level}`.
- Produces: one deterministic evidence-based repository architecture and asset-placement report.

- [x] Define complete Titan Builder metadata.
- [x] Document required and optional variables.
- [x] Define ordered repository inspection and comparison workflow.
- [x] Define plugin use, output schema, validation, failure handling, success criteria, metrics, examples, compatibility, and knowledge capture.
- [x] Verify the prompt solves only repository architecture discovery and canonical asset placement.

### Task 4: Pass review and publication

**Files:**
- Review: all files changed on `feature/prompt-library-pass-01`

**Interfaces:**
- Consumes: completed pass changes.
- Produces: merged, reviewable pass on `main`.

- [x] Compare the branch against `main`.
- [x] Check that only documentation and Markdown assets changed.
- [x] Verify no existing runtime file was modified.
- [x] Open a pull request to `main`.
- [x] Merge the pull request after final review.
