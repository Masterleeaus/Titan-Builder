# Titan Builder Prompt Library Pass 02 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one installable prompt that deterministically detects duplicate and overlapping prompt templates before new assets are added to the Titan Builder Prompt Library.

**Architecture:** Add `TB-PROMPT-FOUND-002` as a standalone Markdown document under the existing browser-extension prompt-library boundary. Keep the pass report-only: no runtime loader, manifest, JavaScript registry, package, or execution changes. Update the cumulative roadmap, review the exact branch diff, verify through repository CI, and merge the pass into `main`.

**Tech Stack:** Markdown prompt assets, GitHub repository search and history, Titan Builder prompt-document contract, Superpowers review, existing GitHub Actions verification.

## Global Constraints

- Start from current `main` and work only on `feature/prompt-library-pass-02`.
- Create exactly one new installable prompt document.
- Store the prompt under `browser-extension/prompt-library/foundation/`.
- Preserve the existing JavaScript prompt cards as the active side-panel runtime source.
- Do not modify root `src/`, `browser-extension/src/`, manifests, packages, workflows, lockfiles, or generated files.
- Search all current prompt-bearing locations before publication.
- The prompt must solve only duplicate and overlap detection; it must not edit, merge, delete, or publish prompts itself.
- The prompt must include every required Titan Builder section and a matching semantic-version change log.
- Merge only after the branch diff is focused and all triggered verification checks succeed.

---

### Task 1: Confirm Duplicate-Detection Scope

**Files:**
- Read: `browser-extension/prompt-library/foundation/tb-prompt-found-001-repository-architecture-discovery.md`
- Read: `browser-extension/src/coding-prompts.js`
- Read: `browser-extension/src/workspace-library.js`
- Read: `src/prompts/system.ts`
- Read: `.titan/todo/issues/Titan-Builder-Prompt-Library-Roadmap.md`
- Read: `docs/superpowers/specs/2026-08-02-titan-builder-prompt-library-design.md`

**Interfaces:**
- Consumes: canonical prompt-location decision, existing prompt inventory, prompt-document contract, and planned prompt catalog.
- Produces: an evidence-based decision that `TB-PROMPT-FOUND-002` is not already implemented and has one objective: classify similarity and recommend lifecycle treatment.

- [x] Search for `duplicate prompt`, `overlap`, `same objective`, `merge prompt`, `supersede prompt`, and equivalent concepts.
- [x] Compare the nearest assets by purpose, variables, workflow, output, tags, validation, and provider assumptions.
- [x] Confirm that architecture placement and duplicate detection are separate objectives.
- [x] Confirm that no current standalone prompt already performs deterministic duplicate classification.

### Task 2: Create `TB-PROMPT-FOUND-002`

**Files:**
- Create: `browser-extension/prompt-library/foundation/tb-prompt-found-002-prompt-duplicate-overlap-detection.md`

**Interfaces:**
- Consumes: `${repository}`, `${branch}`, `${candidate_prompt}`, `${search_scope}`, `${canonical_prompt_path}`, and `${output_path}`.
- Produces: one Markdown duplicate-and-overlap assessment with normalized prompt signatures, weighted comparison scores, evidence, lifecycle decision, compatibility treatment, and knowledge metadata.

- [ ] Define stable metadata and version `1.0.0`.
- [ ] Define required and optional variables without project-specific hardcoding.
- [ ] Define a deterministic normalized-signature model covering objective, outcome, workflow, inputs, variables, outputs, validation, failure handling, tags, dependencies, and provider assumptions.
- [ ] Define explicit similarity weights and classification bands.
- [ ] Define lifecycle decisions: `CREATE`, `KEEP_SEPARATE`, `COMPOSE`, `EXTEND`, `MERGE`, `SUPERSEDE`, and `REJECT_DUPLICATE`.
- [ ] Require exact repository evidence for every material comparison.
- [ ] Prohibit repository writes and automatic deletion or merging.
- [ ] Include realistic examples representing duplicate, substantial-overlap, partial-overlap, and distinct outcomes.
- [ ] Include compatibility, limitations, knowledge capture, and change log.

### Task 3: Update the Cumulative Roadmap

**Files:**
- Modify: `.titan/todo/issues/Titan-Builder-Prompt-Library-Roadmap.md`

**Interfaces:**
- Consumes: Pass 02 branch name and prompt publication state.
- Produces: current pass metadata, `TB-PROMPT-FOUND-002` status, a Pass 02 checklist, and later merge evidence.

- [ ] Record `feature/prompt-library-pass-02` as the current pass branch.
- [ ] Mark `TB-PROMPT-FOUND-002` as `IN PROGRESS — pass 02` before merge.
- [ ] Add the complete Pass 02 checklist.
- [ ] After merge, record the pull request, merge commit, successful checks, and `COMPLETE` status in a focused follow-up update if required.

### Task 4: Review and Verify

**Files:**
- Review: all files changed from `main...feature/prompt-library-pass-02`

**Interfaces:**
- Consumes: completed prompt, plan, and roadmap update.
- Produces: focused pull request and verified merge.

- [ ] Confirm the diff contains only the planned Markdown files.
- [ ] Verify every required prompt section is present.
- [ ] Verify every referenced variable is declared and every declared required variable is used.
- [ ] Verify the objective is limited to comparison and recommendation.
- [ ] Verify score weights total `100` and classification bands are non-overlapping and exhaustive.
- [ ] Verify all examples use declared variables and match the output contract.
- [ ] Perform the final Superpowers review for placeholders, ambiguity, contradictions, duplication, and unsupported claims.
- [ ] Open a pull request to `main`.
- [ ] Wait for all triggered repository verification checks to succeed.
- [ ] Merge the pull request into `main`.
