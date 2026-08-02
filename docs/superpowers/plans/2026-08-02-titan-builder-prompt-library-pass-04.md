# Titan Builder Prompt Library Pass 04 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four production-grade platform-development prompts covering provider compatibility, prompt semantic-version upgrades, Titan Zero–WorkCore authority boundaries, and home/field-service platform architecture.

**Architecture:** Author four independent Markdown prompt assets under the browser-extension prompt-library boundary. Keep every prompt report-oriented or controlled-upgrade-oriented, preserve the existing JavaScript runtime, and track Pass 04 on the three-pass batch branch that will merge only after Pass 06.

**Tech Stack:** Markdown prompt documents, GitHub repository content API, Titan Builder prompt-document contract, existing browser-extension prompt-library architecture.

## Global Constraints

- Work only on `feature/prompt-library-batch-04-06`.
- Pass 04 is the first pass in a three-pass merge batch covering Passes 04, 05, and 06.
- Do not open or merge a pull request after Pass 04.
- Create exactly four standalone prompts in this pass.
- Prompts are for AI developer agents and platform maintainers, not live business operations.
- Canonical prompt files belong under `browser-extension/prompt-library/<category>/`.
- Every prompt must include all 21 required sections from the Titan Builder prompt-document contract.
- Every parser-visible template variable must be declared and documented.
- Do not modify runtime source, manifests, package files, lockfiles, workflows, generated assets, or user data.
- Do not claim the Markdown prompts are visible in the side panel before the catalog-loader migration.
- WorkCore is the authoritative operational record system; Titan Zero may reason, orchestrate, cache, project, and request governed actions but must not create accidental parallel operational truth.

---

### Task 1: Confirm duplicate and scope boundaries

**Files:**
- Inspect: `browser-extension/prompt-library/`
- Inspect: `browser-extension/src/coding-prompts.js`
- Inspect: `browser-extension/src/workspace-library.js`
- Inspect: `src/prompts/`
- Inspect: `docs/`
- Inspect: `.titan/todo/issues/Titan-Builder-Prompt-Library-Roadmap.md`

**Interfaces:**
- Consumes: Pass 01 architecture, `TB-PROMPT-FOUND-002`, `TB-PROMPT-FOUND-003`, and the approved three-pass batching design.
- Produces: one evidence-based duplicate conclusion for each Pass 04 prompt.

- [ ] **Step 1: Search provider compatibility capability**

Search for prompts whose primary objective is auditing one prompt across multiple AI providers, tool environments, output conventions, and execution modes.

Expected: only partial compatibility checks inside specification validation; no standalone compatibility audit.

- [ ] **Step 2: Search semantic-version upgrade capability**

Search for prompts whose primary objective is classifying a proposed prompt change as major, minor, patch, or no release and producing an upgraded prompt contract.

Expected: versioning rules exist in architecture and validation prompts, but no standalone upgrade workflow.

- [ ] **Step 3: Search Titan Zero authority capability**

Search for prompts that audit authoritative WorkCore records against Titan Zero projections, caches, orchestration, commands, events, and duplicated operational stores.

Expected: no standalone prompt.

- [ ] **Step 4: Search field-service platform architecture capability**

Search for prompts that audit the code architecture and runtime reachability of the shared home/field-service platform.

Expected: no standalone prompt; operational workflow ideas are not substitutes for a development architecture audit.

- [ ] **Step 5: Record boundaries in the roadmap update**

Document that all four prompts are developer-agent assets and do not run a live service business.

---

### Task 2: Create the multi-provider compatibility audit prompt

**Files:**
- Create: `browser-extension/prompt-library/foundation/tb-prompt-found-004-multi-provider-prompt-compatibility-audit.md`

**Interfaces:**
- Consumes: one complete candidate prompt, provider targets, specification assessment when available, and repository evidence.
- Produces: one compatibility matrix, portability findings register, adaptation plan, and exactly one compatibility result.

- [ ] **Step 1: Define the singular objective**

The prompt audits one candidate prompt for behavioural portability across named AI providers and execution environments without executing or rewriting the candidate.

- [ ] **Step 2: Define compatibility dimensions**

Include instruction hierarchy, tool invocation, structured output, context limits, file/repository access, multimodal assumptions, web/current-information requirements, code execution, safety boundaries, chain-of-thought wording, background-work assumptions, citations, provider branding, and graceful degradation.

- [ ] **Step 3: Define deterministic results**

Require exactly one of `COMPATIBLE`, `COMPATIBLE_WITH_ADAPTATIONS`, `PROVIDER_SPECIFIC`, or `BLOCKED`.

- [ ] **Step 4: Complete all 21 required sections**

Include exact output matrices, severity rules, failure modes, measurable quality targets, realistic examples, compatibility metadata, Knowledge Capture, and Change Log version `1.0.0`.

- [ ] **Step 5: Validate parser-visible variables**

Confirm every `${...}` token is declared in Required Inputs, Optional Inputs, and Variables as appropriate.

---

### Task 3: Create the prompt semantic-version upgrade prompt

**Files:**
- Create: `browser-extension/prompt-library/foundation/tb-prompt-found-005-prompt-semantic-version-upgrade.md`

**Interfaces:**
- Consumes: one current prompt, one proposed change set, current version, policy evidence, and optional duplicate/specification/compatibility assessments.
- Produces: one release classification, target version, migration analysis, complete upgraded prompt document when permitted, and validation checklist.

- [ ] **Step 1: Define semantic-version rules**

Major covers incompatible objective, variable, output, safety, authority, or lifecycle changes. Minor covers backwards-compatible capability expansion. Patch covers non-behavioural corrections. No release covers rejected, duplicate, or documentation-only proposals that do not alter the canonical prompt.

- [ ] **Step 2: Define controlled upgrade behaviour**

Preserve stable prompt ID unless supersession is required, update metadata and Change Log together, retain backwards compatibility for minor and patch releases, and document migration requirements for major releases.

- [ ] **Step 3: Separate analysis from mutation**

The prompt returns an upgraded standalone document but performs no repository write, commit, tag, release, or publication action.

- [ ] **Step 4: Complete all 21 required sections**

Include change-impact matrix, release decision tree, output schema, failure handling, examples for major/minor/patch/no-release, and version `1.0.0` for the upgrade prompt itself.

- [ ] **Step 5: Validate parser-visible variables**

Confirm examples use plain input labels or declared variables only.

---

### Task 4: Create the Titan Zero and WorkCore authority audit prompt

**Files:**
- Create: `browser-extension/prompt-library/titan-zero/tb-prompt-tz-arch-001-titan-zero-workcore-authority-boundary-audit.md`

**Interfaces:**
- Consumes: repository scope, Titan Zero scope, WorkCore scope, architecture evidence, entity inventory, persistence stores, commands, events, queues, and offline design.
- Produces: one authority-boundary audit report with ownership matrices, duplicate-store findings, sync risks, governed-action gaps, and remediation order.

- [ ] **Step 1: Encode the authority baseline**

WorkCore owns authoritative operational records. Titan Zero reasons, recommends, orchestrates, projects local state, and requests governed actions through validated WorkCore commands.

- [ ] **Step 2: Define audit surfaces**

Cover customers, leads, jobs, schedules, staff, attendance, assets, inventory, documents, invoices, payments, compliance, communications, permissions, tenant boundaries, local device stores, caches, indexes, analytics replicas, queues, commands, events, and reconciliation.

- [ ] **Step 3: Define allowed derived stores**

Allow caches, projections, queues, search indexes, encrypted local stores, and analytics replicas only when authority, provenance, sync direction, conflict handling, expiry, recovery, and deletion rules are explicit.

- [ ] **Step 4: Define deterministic classifications**

Classify each record family and store as authoritative, governed projection, derived replica, transient transport, configuration, audit evidence, duplicated authority, orphaned state, or uncertain.

- [ ] **Step 5: Complete all 21 required sections**

Include exact report structure, evidence standards, failure modes, quality metrics, examples, limitations, compatibility, Knowledge Capture, and Change Log version `1.0.0`.

---

### Task 5: Create the home and field-service platform architecture audit prompt

**Files:**
- Create: `browser-extension/prompt-library/field-service/tb-prompt-field-arch-001-home-field-service-platform-architecture-audit.md`

**Interfaces:**
- Consumes: repository, branch, field-service scope, WorkCore scope, runtime roots, integration documents, mobile/offline surfaces, and optional vertical examples.
- Produces: one platform architecture audit covering capability completeness, runtime reachability, authority, state, integrations, offline behaviour, security, tests, and remediation priority.

- [ ] **Step 1: Define platform-development scope**

Audit how the software supports field-service operations; do not create real jobs, contact customers, schedule workers, issue invoices, or operate a live business.

- [ ] **Step 2: Define capability domains**

Cover lead-to-job conversion, job lifecycle, scheduling, dispatch, routing, reassignment, capacity, mobile experience, offline job packs, location/check-in, time evidence, proof of service, forms, variations, incidents, quality, compliance, assets, inventory, billing handoff, customer visibility, and analytics.

- [ ] **Step 3: Trace runtime reachability**

Require evidence from UI entry points through routes, APIs, services, domain logic, persistence, queues, events, permissions, WorkCore integration, offline sync, and tests.

- [ ] **Step 4: Preserve vertical neutrality**

Use cleaning as an optional example while rejecting cleaning-only assumptions in shared field-service architecture.

- [ ] **Step 5: Complete all 21 required sections**

Include architecture maps, capability matrix, defect classifications, output schema, failure handling, success criteria, quality metrics, examples, compatibility, Knowledge Capture, and Change Log version `1.0.0`.

---

### Task 6: Update the cumulative roadmap

**Files:**
- Modify: `.titan/todo/issues/Titan-Builder-Prompt-Library-Roadmap.md`

**Interfaces:**
- Consumes: the four completed prompt files and the three-pass batching design.
- Produces: accurate Pass 04 status and planned Pass 05/06 batch continuation.

- [ ] **Step 1: Record the active batch branch**

Add `feature/prompt-library-batch-04-06` and state that merge occurs after Pass 06.

- [ ] **Step 2: Change pass policy**

Replace the one-prompt-per-pass rule with three or four closely related prompts per pass and a three-pass merge cadence.

- [ ] **Step 3: Add Titan Zero and field-service development categories**

Add roadmap sections for Titan Zero platform development and home/field-service platform development.

- [ ] **Step 4: Mark Pass 04 prompts complete on the batch branch**

Use wording that distinguishes branch completion from merged-to-main completion.

- [ ] **Step 5: Add the Pass 04 checklist**

Record duplicate scans, prompt creation, validation, diff review, and the deliberate no-merge state.

---

### Task 7: Verify Pass 04 without merging

**Files:**
- Inspect: all Pass 04 files on `feature/prompt-library-batch-04-06`

**Interfaces:**
- Consumes: the Pass 04 branch delta.
- Produces: evidence that Pass 04 is structurally complete and safe to carry into Pass 05.

- [ ] **Step 1: Compare the branch against the batch base**

Confirm changes are limited to prompt documents, design/plan documentation, and the roadmap.

- [ ] **Step 2: Validate identity and structure**

Confirm filenames, IDs, versions, 21 headings, metadata, and Change Logs agree.

- [ ] **Step 3: Validate variables**

Reconcile every parser-visible `${...}` token against each prompt's declared variables.

- [ ] **Step 4: Validate objective boundaries**

Confirm the Titan Zero and field-service prompts are platform-development audits, not operational business workflows.

- [ ] **Step 5: Record batch state**

Do not create a pull request or merge. Report that Pass 04 is complete on the batch branch and that Pass 05 should continue from the same branch.
