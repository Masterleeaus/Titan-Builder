# Integrity-Bound Browser Run Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent browser-run recovery from restoring approval state when the prepared artifact, visible preview record, or persisted audit sequence no longer describe the same reviewed operations.

**Architecture:** Preserve the existing run-store API while moving the current implementation behind an integrity-enforcing facade. The facade writes a versioned content-addressed envelope containing deterministic visible previews, record and audit-prefix revisions, project/run identity, and raw-response digest; reads validate every binding and quarantine any mismatch before returning an artifact to the coordinator.

**Tech Stack:** TypeScript, Node.js crypto and filesystem APIs, node:test, existing browser-run store/coordinator contracts.

## Global Constraints

- Preserve existing coordinator, approval, and recovery APIs.
- Do not introduce a new external dependency or secret-management system.
- Approval restoration must fail closed on missing, stale, swapped, truncated, duplicated, malformed, or mismatched persistence.
- Later legitimate audit events may extend, but never rewrite, the integrity-bound audit prefix.

---

### Task 1: Deterministic aggregate integrity

**Files:**
- Create: `src/workflows/browser-run-integrity.ts`

**Interfaces:**
- Consumes: `BrowserRunRecord`, `BrowserPreparedArtifact`, `BrowserRunEvent[]`, `PlannedOperation[]`.
- Produces: `createIntegrityBoundPreparedArtifact()`, `verifyIntegrityBoundPreparedArtifact()`, and `reducePlansToBrowserPreviews()`.

- [x] Define schema version 1 and exact envelope fields.
- [x] Derive operation IDs and visible previews deterministically from full plans.
- [x] Bind run/project identity, visible record revision, raw response, plan/operation mapping, preview revision, and audit prefix.
- [x] Canonicalize JSON before SHA-256 content addressing.
- [x] Reject unknown envelope fields and malformed digest/revision values.

### Task 2: Fail-closed store facade

**Files:**
- Preserve as core: `src/workflows/browser-run-store-core.ts`
- Replace facade: `src/workflows/browser-run-store.ts`

**Interfaces:**
- Consumes: the existing `BrowserRunStore` contract.
- Produces: the same contract with integrity-bound `setPrepared()` and `getPrepared()` behavior.

- [x] Wrap prepared writes in the versioned envelope.
- [x] Read disk artifacts directly so post-write tampering cannot be hidden by an in-memory cache.
- [x] Parse the complete audit JSONL strictly rather than silently dropping malformed lines.
- [x] Quarantine invalid prepared files under a unique non-active filename.
- [x] Append a redacted `integrity_quarantine` audit event when possible.
- [x] Return `null` so coordinator recovery transitions the run to review-required failure.

### Task 3: Regression and tamper matrix

**Files:**
- Create: `src/workflows/browser-run-integrity.test.ts`
- Modify: `package.json`

**Interfaces:**
- Tests the public `createBrowserRunStore()` facade and persisted files.

- [x] Verify a matching aggregate survives restart.
- [x] Mutate every top-level integrity-bound field independently.
- [x] Swap prepared files between runs.
- [x] Mutate the visible record and audit prefix.
- [x] Duplicate an audit event.
- [x] Truncate or remove the prepared write.
- [x] Assert invalid files are quarantined and never returned for approval recovery.

### Task 4: Verification and publication

- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run test:node`.
- [ ] Run `pnpm run test:integration`.
- [ ] Run `pnpm run build`.
- [ ] Review the exact branch diff for unrelated changes and secret exposure.
- [ ] Open a draft pull request linked with `Fixes #146`.
