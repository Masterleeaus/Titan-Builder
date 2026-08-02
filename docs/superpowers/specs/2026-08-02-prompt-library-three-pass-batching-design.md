# Titan Builder Three-Pass Prompt Library Batching Design

## Status

Approved by the user's instruction to create three to four prompts per pass and merge work every three passes.

## Goal

Increase prompt-library throughput while retaining duplicate prevention, standalone specification quality, parser-aware variable validation, reviewable commits, and evidence-based verification.

## Scope boundary

The Titan Builder prompt library is a platform-development asset library for AI developer agents, maintainers, architects, reviewers, testers, and migration agents.

It may contain prompts that analyse, design, implement, test, migrate, document, or audit Titan Zero, WorkCore, browser-extension, home-service, field-service, cleaning-vertical, and supporting platform code.

It must not contain prompts whose primary purpose is to operate a live service business. Business-operational actions such as creating a real customer job, dispatching a real cleaner, sending an invoice, contacting a customer, recording attendance, or collecting payment belong in future Titan Zero operational skill and workflow libraries, not this development prompt library.

## Batch cadence

Prompt development uses three-pass merge batches.

- Each pass creates three or four closely related standalone prompts.
- Each prompt receives its own duplicate scan, specification validation, variable review, examples, failure handling, compatibility declaration, Knowledge Capture, and Change Log.
- Passes in one batch share a dedicated branch.
- The branch is not merged after the first or second pass.
- After the third pass, the complete batch receives branch-diff review, repository CI, pull-request review, and one merge into `main`.
- If any pass is blocked or introduces unresolved defects, the branch remains unmerged.

The first batch branch is:

```text
feature/prompt-library-batch-04-06
```

It contains Passes 04, 05, and 06.

## Pass-level commits

A pass should remain independently reviewable inside the batch branch.

Each pass should add:

1. one implementation plan;
2. three or four complete prompt documents;
3. one cumulative-roadmap update;
4. no unrelated runtime changes.

Supporting architecture documentation may be added when a pass introduces a new library boundary or governance rule.

## Canonical locations

Standalone prompts remain under:

```text
browser-extension/prompt-library/<category>/<prompt-id>-<slug>.md
```

Pass 04 introduces these platform-development categories:

```text
browser-extension/prompt-library/foundation/
browser-extension/prompt-library/titan-zero/
browser-extension/prompt-library/field-service/
```

Executable catalog loading remains a later migration. Markdown prompts are canonical authoring and version-history assets but are not yet claimed to appear in the side-panel runtime.

## Pass 04 prompt set

Pass 04 creates four developer-agent prompts:

1. `TB-PROMPT-FOUND-004` — Multi-Provider Prompt Compatibility Audit
2. `TB-PROMPT-FOUND-005` — Prompt Semantic Version Upgrade
3. `TB-PROMPT-TZ-ARCH-001` — Titan Zero and WorkCore Authority Boundary Audit
4. `TB-PROMPT-FIELD-ARCH-001` — Home and Field-Service Platform Architecture Audit

The Titan Zero and field-service prompts analyse and improve platform architecture. They do not perform live business operations.

## Titan Zero authority rule

The Titan Zero authority prompt must enforce this architectural baseline:

> WorkCore owns authoritative operational records. Titan Zero reasons, recommends, orchestrates, projects local state, and requests governed actions through validated WorkCore commands.

The audit must detect accidental parallel systems for customers, leads, jobs, schedules, staff, attendance, assets, inventory, documents, invoices, payments, compliance records, and other operational truth.

Local caches, offline projections, search indexes, encrypted device stores, queues, and analytics replicas are allowed only when their authority, synchronisation, conflict, expiry, provenance, and recovery rules are explicit.

## Field-service platform boundary

The field-service architecture audit must inspect the software capability stack rather than operate a service business. Its audit surface includes:

- lead-to-job conversion boundaries;
- job lifecycle and status transitions;
- scheduling, dispatch, routing, reassignment, and capacity;
- field-worker mobile and tablet experience;
- offline job packs, queues, conflict resolution, and recovery;
- check-in, location, attendance, and time evidence;
- photos, signatures, forms, checklists, proof of service, and audit history;
- variations, approvals, incidents, quality, compliance, assets, inventory, billing handoff, and customer visibility;
- WorkCore entity ownership and Titan Zero orchestration;
- API, event, queue, persistence, permission, and test reachability.

Cleaning may be used as the first vertical example, but shared field-service architecture must not hardcode cleaning-only assumptions.

## Quality gates

Every prompt in a pass must satisfy the complete Titan Builder prompt-document contract:

- all 21 required sections;
- one singular and testable objective;
- stable ID, filename, semantic version, and Change Log agreement;
- declared required and optional inputs;
- no undeclared parser-visible template tokens;
- deterministic execution ordering and stopping conditions;
- explicit plugin policy and fallback behaviour;
- structurally testable output;
- validation rules and failure handling;
- measurable success criteria and quality metrics;
- realistic examples using declared variables;
- limitations and compatibility;
- Knowledge Capture.

`TB-PROMPT-FOUND-002` remains the duplicate-governance reference. `TB-PROMPT-FOUND-003` remains the specification-validation reference.

## Verification and merge policy

After each pass:

- inspect the exact branch delta added by that pass;
- verify prompt paths, IDs, headings, variables, versions, and roadmap status;
- keep the pass on the batch branch.

After Pass 06:

- compare the full batch branch against current `main`;
- resolve drift from intervening main-branch changes;
- run all triggered repository verification workflows;
- merge only when all required checks pass;
- record the batch PR, merge commit, included passes, and verification evidence in the roadmap.

## Non-goals

This design does not:

- add runtime catalog loading;
- replace existing JavaScript prompt cards;
- add live business-operation prompts;
- implement Titan Zero or field-service runtime code;
- merge after Pass 04 or Pass 05;
- weaken per-prompt validation because prompts share a pass or batch.
