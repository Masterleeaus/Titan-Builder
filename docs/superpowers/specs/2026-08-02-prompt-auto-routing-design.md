# Titan Builder Prompt Auto-Routing Design

## Status

Approved by the user's instruction to enable automatic prompt selection during Pass 05.

## Goal

Connect Titan Builder's canonical and built-in prompt libraries to the secure browser-first Work workflow so a user can describe a development task naturally and the system can select and apply the most relevant prompt without requiring manual library browsing.

## Product boundary

This feature routes **platform-development prompts** for AI developer agents. It may select prompts that audit, design, implement, test, migrate, document, or review Titan Builder, Titan Zero, WorkCore, browser-extension, home-service, field-service, and cleaning-vertical software.

It does not route prompts for operating live field-service businesses. It must not create live jobs, dispatch workers, send invoices, contact customers, record attendance, or collect payments.

## Existing architecture

The browser extension currently has two disconnected paths:

1. `browser-extension/src/coding-prompts.js` provides concise built-in prompt cards that users choose manually.
2. `browser-extension/prompt-library/` stores canonical standalone Markdown prompts but has no runtime catalog loader.
3. `browser-extension/src/agent-workspace.js` sends the raw Work task to the secure local bridge.
4. The local bridge already performs project registration, context preparation, provider execution, operation preview, approval, application, verification, stale-preview recovery, and audit history.

Prompt selection therefore belongs before a Work run is created. It must not bypass or replace the existing operation-approval pipeline.

## Chosen approach

Use a hybrid deterministic router.

### Why this approach

A keyword-only router is too brittle, while a second AI classification request for every user task adds cost, latency, provider dependence, and another failure boundary.

The hybrid router uses deterministic lexical scoring with explicit prompt metadata, confidence thresholds, score margins, and manual override. It may later accept an optional model-based tie breaker, but the first production version does not require one.

## Components

### Canonical prompt catalog generator

Create `scripts/generate-prompt-catalog.mjs`.

The generator scans Markdown files beneath `browser-extension/prompt-library/`, validates canonical prompt identity, extracts routing metadata, and writes:

```text
browser-extension/src/generated/prompt-catalog.js
```

Each generated record contains:

- stable prompt ID;
- name and title;
- version;
- status;
- category;
- tags;
- dependencies;
- compatible providers;
- related prompts;
- purpose;
- description excerpt;
- source path;
- routing intents;
- negative routing intents;
- supported Work modes;
- risk classification.

The generated catalog contains metadata and paths, not duplicate full prompt bodies.

### Canonical prompt loader

Create `browser-extension/src/prompt-catalog.js`.

It combines generated canonical records with the existing concise built-in coding cards. It loads a canonical Markdown body only after that prompt is selected by using an injected loader or `fetch(chrome.runtime.getURL(path))` in the browser extension.

The loader validates that the fetched document ID matches the catalog record before use.

### Deterministic prompt router

Create `browser-extension/src/prompt-router.js`.

The router:

1. normalises the user's task;
2. honours an explicit prompt ID first;
3. tokenises title, purpose, description, category, tags, routing intents, and negative intents;
4. applies weighted phrase and token scoring;
5. penalises negative-intent matches;
6. filters prompts incompatible with the selected Work mode;
7. returns ranked candidates with evidence;
8. auto-selects only when the score and score margin exceed configured thresholds;
9. returns `ambiguous` when multiple candidates are plausible;
10. returns `none` when no prompt is sufficiently relevant.

The router must be deterministic for identical inputs and catalogs.

### Prompt execution envelope

Create a composition function that wraps the selected canonical or built-in prompt with the actual Work request.

The envelope includes:

- selected prompt identity and version;
- routing mode and confidence;
- the user's original request unchanged;
- current registered-project and branch context supplied by the existing runtime;
- an instruction to resolve prompt variables from runtime context and the user request;
- an instruction to return a focused question or blocked result when required values remain unresolved;
- the selected prompt body.

The original user request must remain visible and must not be silently rewritten.

### Work UI integration

Update the Work form with:

- prompt routing mode: `Auto`, `Manual`, or `Off`;
- manual prompt selector;
- visible routing recommendation;
- confidence and short reason;
- top alternatives when ambiguous.

Defaults:

- routing mode: `Auto`;
- manual selector: none;
- ambiguous or no-match result: send the raw user request unchanged;
- explicit manual selection: always use the selected prompt;
- `Off`: never route.

The selection shown immediately before submission must be the selection actually used.

## Scoring model

The initial deterministic score uses these maximum contributions:

| Signal | Maximum |
|---|---:|
| Explicit prompt ID or exact title | 100 |
| Exact routing-intent phrase | 40 |
| Title token overlap | 24 |
| Purpose token overlap | 20 |
| Tags and category overlap | 16 |
| Description overlap | 12 |
| Built-in content overlap | 8 |
| Negative-intent penalty | -40 |
| Mode incompatibility | excluded |

Auto-selection defaults:

- minimum score: `28`;
- minimum lead over second candidate: `8`;
- exact ID/title match bypasses threshold;
- score and lead are returned for UI and tests.

## Routing metadata

Canonical Markdown prompts may add these Metadata fields:

- `Routing Intents`
- `Negative Routing Intents`
- `Work Modes`
- `Routing Risk`

Existing prompts without those fields remain routable through title, purpose, description, category, and tags.

Built-in coding cards may add equivalent JavaScript properties without changing their existing card API.

## Safety and authority

Prompt routing changes instruction selection only.

It must not:

- execute filesystem operations in the extension;
- grant permissions;
- approve operations;
- bypass the local bridge;
- bypass stale-preview checks;
- bypass high-risk confirmation;
- change project registration or path containment;
- claim that a prompt or operation ran when it did not.

Agent operations continue through the existing two-stage review and final-apply flow.

## Failure handling

- Stale generated catalog: fail the catalog check and retain built-in prompts.
- Canonical body fetch failure: show the failure and submit the raw request only when the user explicitly accepts fallback; otherwise block submission.
- Ambiguous route: show top candidates and submit raw request unless the user chooses one.
- No route: submit raw request unchanged.
- Invalid manual ID: reject submission and require a valid choice.
- Catalog ID/body mismatch: block use of that canonical prompt.
- Unsupported mode: exclude the prompt from auto-selection and reject manual use with a clear message.

## Testing

Tests must cover:

- catalog metadata extraction and stable ordering;
- stale generated catalog detection;
- exact ID and title selection;
- title, purpose, tag, category, and routing-intent scoring;
- negative-intent penalties;
- Work-mode filtering;
- high-confidence selection;
- ambiguous result;
- no-match result;
- manual override;
- off mode;
- canonical body identity validation;
- execution-envelope preservation of the original user request;
- Work payload uses the routed prompt selected in the UI;
- raw prompt fallback when routing is ambiguous or disabled;
- existing operation approval and application behaviour remains unchanged.

## Pass 05 prompt assets

Pass 05 also creates three platform-development prompts that support this runtime:

1. `TB-PROMPT-FOUND-006` — Prompt Library Metadata Index Generation
2. `TB-PROMPT-FOUND-007` — Prompt Installability Verification
3. `TB-PROMPT-PROMPT-001` — Production Prompt Template Generator

## Batch policy

Pass 05 remains on `feature/prompt-library-batch-04-06`.

A draft pull request may be opened during Pass 05 solely to run red/green CI and review the accumulated branch. It must not be merged until Pass 06 is complete, the branch is reconciled with current `main`, and all required verification succeeds.
