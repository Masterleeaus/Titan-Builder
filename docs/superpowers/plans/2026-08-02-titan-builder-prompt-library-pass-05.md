# Titan Builder Prompt Library Pass 05 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three production prompt assets and connect the prompt library to the browser-first Work workflow through deterministic automatic prompt routing.

**Architecture:** Generate a compact runtime catalog from canonical Markdown prompts, combine it with existing built-in cards, route natural-language Work requests using deterministic weighted scoring, lazily load the selected canonical body, and compose it with the original request before creating the existing secure browser run. Routing affects instructions only; the local bridge remains responsible for project context, operation preview, approval, application, verification, and audit history.

**Tech Stack:** Markdown prompt assets, Node.js ESM generator, browser-extension JavaScript modules, Chrome extension APIs, Node test runner, existing OpenBrowser Work workflow.

## Global Constraints

- Work only on `feature/prompt-library-batch-04-06`.
- Pass 05 creates exactly three standalone prompts plus supporting runtime code.
- All prompts are platform-development instructions, not live business-operation prompts.
- Preserve the original user request verbatim inside the routed execution envelope.
- Auto-selection requires deterministic score and margin thresholds.
- Ambiguous or no-match routing sends the raw request unchanged.
- Manual selection overrides automatic routing.
- Off mode never applies a prompt.
- Canonical Markdown bodies are loaded only after selection.
- Prompt routing must not bypass project registration, path containment, tenant controls, operation review, explicit high-risk approval, stale-preview detection, final confirmation, verification, or audit history.
- No prompt body may be duplicated manually into runtime source.
- A draft PR may be used for CI, but the batch must not merge before Pass 06.

---

### Task 1: Add red tests for routing and loading

**Files:**
- Modify: `browser-extension/src/prompt-library.test.mjs`
- Modify: `browser-extension/src/agent-workspace.test.mjs`

**Interfaces:**
- Consumes: existing `buildCreateRunPayload` and prompt-library utilities.
- Produces test contracts for `rankPrompts`, `routePromptRequest`, `composeRoutedPrompt`, `loadCanonicalPromptBody`, and routed Work payloads.

- [ ] Add tests that import the not-yet-created router and catalog modules.
- [ ] Test exact prompt-ID selection.
- [ ] Test exact-title selection.
- [ ] Test weighted routing-intent, title, purpose, tag, and category matches.
- [ ] Test negative-intent penalties.
- [ ] Test Work-mode exclusion.
- [ ] Test high-confidence selection with score and margin.
- [ ] Test ambiguous routing when candidates are close.
- [ ] Test no-match routing.
- [ ] Test manual override and off mode.
- [ ] Test canonical body ID validation.
- [ ] Test the execution envelope preserves the original request verbatim.
- [ ] Test `buildCreateRunPayload` accepts an already-routed prompt without changing existing context, provider, or verification behaviour.
- [ ] Open a draft PR and confirm CI fails because the new modules do not exist.

### Task 2: Create prompt-catalog generator and generated index

**Files:**
- Create: `scripts/generate-prompt-catalog.mjs`
- Create: `browser-extension/src/generated/prompt-catalog.js`
- Create: `scripts/prompt-catalog.test.mjs`

**Interfaces:**
- Produces `GENERATED_PROMPT_CATALOG`, an immutable array of metadata records.
- Each record contains `id`, `title`, `version`, `status`, `category`, `tags`, `dependencies`, `compatibleProviders`, `relatedPrompts`, `purpose`, `description`, `path`, `routingIntents`, `negativeRoutingIntents`, `workModes`, and `routingRisk`.

- [ ] Implement deterministic recursive Markdown discovery below `browser-extension/prompt-library/`.
- [ ] Parse the Metadata table and the first paragraphs of Purpose and Description.
- [ ] Validate IDs against `TB-PROMPT-<CATEGORY>-NNN`.
- [ ] Validate filename prefix against the lower-case prompt ID.
- [ ] Reject duplicate IDs and duplicate source paths.
- [ ] Parse comma- or semicolon-separated routing metadata.
- [ ] Default Work Modes to `ask, agent` and Routing Risk to `standard`.
- [ ] Sort records by stable ID.
- [ ] Render only metadata and paths, never full prompt bodies.
- [ ] Add `--check` mode with line-ending normalisation.
- [ ] Generate the catalog containing every canonical prompt on the batch branch.
- [ ] Add generator tests for metadata extraction, defaults, duplicate detection, and stale output.

### Task 3: Implement deterministic prompt routing

**Files:**
- Create: `browser-extension/src/prompt-router.js`
- Modify: `browser-extension/src/prompt-library.test.mjs`

**Interfaces:**
- `rankPrompts(request, prompts, options) -> RankedPrompt[]`
- `routePromptRequest(request, prompts, options) -> PromptRouteResult`
- `composeRoutedPrompt(input) -> string`

- [ ] Implement Unicode-safe lower-case tokenisation.
- [ ] Remove low-value stop words without removing technical identifiers.
- [ ] Honour explicit prompt IDs and exact titles before lexical scoring.
- [ ] Score routing-intent phrases, title tokens, purpose tokens, tags, category, description, and optional content.
- [ ] Apply negative-intent penalties.
- [ ] Exclude prompts incompatible with the selected Work mode.
- [ ] Return evidence explaining matched signals.
- [ ] Auto-select only at score `>= 28` with lead `>= 8`.
- [ ] Return `ambiguous` for a plausible top candidate without sufficient lead.
- [ ] Return `none` below the minimum relevance floor.
- [ ] Implement manual and off modes.
- [ ] Compose a bounded execution envelope containing prompt identity, routing evidence, original request, variable-resolution rules, and selected body.
- [ ] Keep output deterministic for identical inputs.

### Task 4: Implement runtime catalog and canonical body loading

**Files:**
- Create: `browser-extension/src/prompt-catalog.js`
- Modify: `browser-extension/src/coding-prompts.js`
- Modify: `browser-extension/src/prompt-library.test.mjs`

**Interfaces:**
- `getRuntimePromptCatalog({ builtins, canonical }) -> PromptRecord[]`
- `loadCanonicalPromptBody(record, loader?) -> Promise<string>`
- `resolvePromptBody(record, loader?) -> Promise<string>`

- [ ] Normalise generated canonical records and existing built-in cards into one routing shape.
- [ ] Add routing intents, negative intents, Work modes, and risk to relevant built-in cards.
- [ ] Preserve the existing built-in card properties and manual prompt-library behaviour.
- [ ] Load canonical bodies through an injected loader in tests or `fetch(chrome.runtime.getURL(path))` in the extension.
- [ ] Validate the fetched document's Metadata ID against the selected record.
- [ ] Reject missing, empty, mismatched, or unsupported bodies.
- [ ] Return built-in content directly without fetching.

### Task 5: Integrate routing into the Work workflow

**Files:**
- Modify: `browser-extension/src/agent-workspace.js`
- Modify: `browser-extension/src/agent-workspace.test.mjs`
- Modify: `browser-extension/src/sidepanel.html`
- Modify: `browser-extension/src/agent-workspace.css`

**Interfaces:**
- `prepareRoutedWorkPrompt(input, dependencies) -> Promise<PreparedPrompt>`
- `PreparedPrompt` includes `prompt`, `originalPrompt`, `route`, and `selectedPrompt`.

- [ ] Add Auto, Manual, and Off routing controls to the Work form.
- [ ] Add a manual prompt selector populated from the runtime catalog.
- [ ] Add a visible recommendation region with selected prompt, confidence, evidence, and alternatives.
- [ ] Recompute recommendation when task text, mode, routing mode, or manual prompt changes.
- [ ] On submit, resolve the exact currently displayed route.
- [ ] Lazily load and compose the selected body.
- [ ] Submit the original request unchanged when auto routing returns ambiguous or none.
- [ ] Reject invalid manual selections and canonical body load failures.
- [ ] Keep the existing Ask/Agent payload fields unchanged except for the composed `prompt` value.
- [ ] Keep all review, approval, stale-preview, apply, and verification logic unchanged.
- [ ] Surface routing information in the run notice without claiming execution success.

### Task 6: Create `TB-PROMPT-FOUND-006`

**Files:**
- Create: `browser-extension/prompt-library/foundation/tb-prompt-found-006-prompt-library-metadata-index-generation.md`

- [ ] Create all 21 required sections.
- [ ] Define deterministic discovery, metadata extraction, duplicate detection, sorting, generated-file checks, path containment, and failure handling.
- [ ] Include routing metadata fields and runtime-consumer compatibility.
- [ ] Make the prompt report or generate an index without publishing or merging.
- [ ] Add realistic examples, measurable metrics, Knowledge Capture, and Change Log `1.0.0`.

### Task 7: Create `TB-PROMPT-FOUND-007`

**Files:**
- Create: `browser-extension/prompt-library/foundation/tb-prompt-found-007-prompt-installability-verification.md`

- [ ] Create all 21 required sections.
- [ ] Verify catalog presence, source-body resolution, variable parsing, routing visibility, extension packaging, provider compatibility, and runtime fallback.
- [ ] Distinguish authoring validity from runtime installability.
- [ ] Return exactly one installability result without modifying the repository.
- [ ] Add realistic examples, measurable metrics, Knowledge Capture, and Change Log `1.0.0`.

### Task 8: Create `TB-PROMPT-PROMPT-001`

**Files:**
- Create: `browser-extension/prompt-library/prompt-authoring/tb-prompt-prompt-001-production-prompt-template-generator.md`

- [ ] Create all 21 required sections.
- [ ] Generate one production prompt from one bounded objective.
- [ ] Require duplicate assessment, specification validation, routing metadata, variables, deterministic workflow, output, failure handling, compatibility, Knowledge Capture, and semantic versioning.
- [ ] Prevent live-business-operation prompts from entering the Titan Builder platform-development library.
- [ ] Return one standalone prompt document without publishing it.
- [ ] Add realistic examples, measurable metrics, Knowledge Capture, and Change Log `1.0.0`.

### Task 9: Add scripts and verification wiring

**Files:**
- Modify after current-main reconciliation: `package.json`
- Modify after current-main reconciliation: `scripts/check-extension.mjs` if required

- [ ] Preserve the skill-registry scripts currently on `main`.
- [ ] Add `generate:prompts` and `check:prompts` scripts.
- [ ] Add `scripts/prompt-catalog.test.mjs` and any new browser-extension test files to `test:node`.
- [ ] Add `check:prompts` to offline and full verification.
- [ ] Confirm the generated prompt catalog is included by extension checks.
- [ ] Do not remove or weaken existing Linux, Windows, skill-registry, browser-workflow, or security verification.

### Task 10: Update roadmap and validate Pass 05

**Files:**
- Modify: `.titan/todo/issues/Titan-Builder-Prompt-Library-Roadmap.md`

- [ ] Mark Pass 05 complete on the batch branch, not merged.
- [ ] Mark FOUND-006, FOUND-007, and PROMPT-001 complete on the batch branch.
- [ ] Record auto-routing runtime files and safety boundary.
- [ ] Record draft PR and red/green CI evidence.
- [ ] Record current-main drift and reconciliation requirements.
- [ ] Scan all new prompts for required sections, undeclared parser-visible variables, placeholders, version mismatch, and score arithmetic.
- [ ] Compare branch delta against the batch base and current main.
- [ ] Do not merge the batch before Pass 06.
