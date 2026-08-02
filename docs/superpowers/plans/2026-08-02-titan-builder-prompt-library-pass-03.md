# Titan Builder Prompt Library Pass 03 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `TB-PROMPT-FOUND-003`, a deterministic standalone prompt that validates one candidate prompt against the Titan Builder prompt-document specification without rewriting or publishing it.

**Architecture:** Keep the asset inside `browser-extension/prompt-library/foundation/` and preserve the established separation between canonical Markdown prompt documents and executable code under `browser-extension/src/`. The prompt will consume one candidate prompt, apply a fixed validation contract, classify findings by severity, calculate a publication-readiness result, and return a report only.

**Tech Stack:** Markdown prompt assets, GitHub repository search and history, Titan Builder prompt-library conventions, Superpowers review, existing repository CI.

## Global Constraints

- Start from current `main` and work only on `feature/prompt-library-pass-03`.
- Create exactly one new standalone production prompt.
- Do not modify runtime JavaScript, TypeScript, manifests, package files, workflows, lockfiles, generated output, or user data.
- Search existing canonical prompts, runtime prompt cards, system prompts, documentation, plans, and issue records before authoring.
- Preserve `TB-PROMPT-FOUND-001` as the architecture-placement prompt and `TB-PROMPT-FOUND-002` as the duplicate-and-overlap prompt.
- Make `TB-PROMPT-FOUND-003` report-only: it may identify defects and prescribe remediation, but it must not rewrite, commit, merge, or publish the candidate prompt.
- Use only declared `${variable}` tokens; examples must not introduce parser-visible undeclared variables.
- Require one primary prompt objective and one final publication-readiness decision.
- Open a pull request and merge only after structural review and all triggered checks succeed.

---

### Task 1: Confirm the unique validation boundary

**Files:**
- Inspect: `docs/superpowers/specs/2026-08-02-titan-builder-prompt-library-design.md`
- Inspect: `browser-extension/prompt-library/foundation/tb-prompt-found-001-repository-architecture-discovery.md`
- Inspect: `browser-extension/prompt-library/foundation/tb-prompt-found-002-prompt-duplicate-overlap-detection.md`
- Inspect: `browser-extension/src/coding-prompts.js`
- Inspect: `src/prompts/`
- Inspect: `.titan/todo/issues/Titan-Builder-Prompt-Library-Roadmap.md`

**Interfaces:**
- Consumes: the established prompt-document contract and duplicate-prevention policy.
- Produces: a confirmed objective boundary for `TB-PROMPT-FOUND-003`.

- [ ] Search for prompts or instructions whose primary objective is validating a complete prompt specification.
- [ ] Compare any relevant result by purpose, inputs, workflow, output, validation, and lifecycle role.
- [ ] Record that architecture discovery, duplicate classification, prompt repair, and publication are outside this prompt's objective.
- [ ] Confirm the candidate being validated is exactly one prompt document.

### Task 2: Author `TB-PROMPT-FOUND-003`

**Files:**
- Create: `browser-extension/prompt-library/foundation/tb-prompt-found-003-prompt-specification-validation.md`

**Interfaces:**
- Consumes: one candidate prompt, the canonical specification contract, repository evidence, and optional policy inputs.
- Produces: one deterministic Markdown validation report with finding severity, section coverage, variable integrity, behavioural checks, score calculation, and one publication-readiness decision.

- [ ] Add complete metadata with ID `TB-PROMPT-FOUND-003`, version `1.0.0`, dependencies, providers, tags, and related prompts.
- [ ] Define required and optional inputs and one authoritative Variables section.
- [ ] Validate metadata, required sections, objective singularity, input-variable consistency, template-token integrity, workflow determinism, plugin policy, output contract, validation, failure handling, examples, compatibility, Knowledge Capture, and change log.
- [ ] Define severity levels `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, and `INFO` with deterministic publication consequences.
- [ ] Define a fixed weighted score whose dimensions total exactly `100`.
- [ ] Define exactly one final result from `PASS`, `PASS_WITH_WARNINGS`, `FAIL`, or `BLOCKED`.
- [ ] Add failure handling for inaccessible candidates, malformed documents, ambiguous objectives, unsupported formats, unresolved canonical specifications, and incomplete evidence.
- [ ] Add realistic examples covering a valid prompt, undeclared variables, multiple objectives, missing failure handling, hardcoded assumptions, and blocked validation.
- [ ] Add Limitations, Compatibility, Knowledge Capture, and Change Log sections.

### Task 3: Perform structural validation

**Files:**
- Validate: `browser-extension/prompt-library/foundation/tb-prompt-found-003-prompt-specification-validation.md`

**Interfaces:**
- Consumes: the completed prompt document.
- Produces: evidence that the prompt is internally consistent and installable as a standalone Markdown asset.

- [ ] Confirm every required prompt-document section is present exactly once.
- [ ] Confirm the prompt has one objective and does not perform repair or repository writes.
- [ ] Confirm all required variables are documented and all parser-visible template tokens are declared.
- [ ] Confirm no example introduces undeclared `${...}` tokens.
- [ ] Confirm severity and final-result rules are non-overlapping and exhaustive.
- [ ] Confirm score weights total `100` and score bands have no gaps or overlaps.
- [ ] Confirm every output heading required by the prompt is defined in Expected Output Format.
- [ ] Confirm all examples use only declared variables and match the allowed final results.
- [ ] Compare against `TB-PROMPT-FOUND-001` and `TB-PROMPT-FOUND-002` to ensure distinct objective and composability.

### Task 4: Update the roadmap and integrate

**Files:**
- Modify: `.titan/todo/issues/Titan-Builder-Prompt-Library-Roadmap.md`

**Interfaces:**
- Consumes: the validated Pass 03 asset and repository verification results.
- Produces: an accurate cumulative status record on `main`.

- [ ] Mark Pass 03 active and `TB-PROMPT-FOUND-003` in progress on the feature branch.
- [ ] Compare `main...feature/prompt-library-pass-03` and confirm only intended Markdown files changed.
- [ ] Open a pull request describing duplicate-search evidence, validation rules, and runtime impact.
- [ ] Wait for every triggered GitHub Actions workflow to finish successfully.
- [ ] Merge the pull request into `main` using the verified head SHA.
- [ ] Create a roadmap-only completion branch from updated `main`.
- [ ] Mark `TB-PROMPT-FOUND-003` complete, record the pull request and merge commit, and identify `TB-PROMPT-FOUND-004` as next.
- [ ] Verify and merge the roadmap completion pull request.

## Pass Completion Evidence

Pass 03 is complete only when:

- `TB-PROMPT-FOUND-003` exists on `main` at the canonical path;
- its structural contract has been reviewed against the architecture specification;
- no undeclared parser-visible variables remain;
- all triggered checks report `success`;
- the cumulative roadmap records the pass and next prompt;
- no runtime source or configuration was modified.
