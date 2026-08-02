# Titan Zero and Field-Service Development Agent Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 45 canonical development-only agent profiles for Titan Zero, reusable home and field-service software, and three initial service verticals.

**Architecture:** Store standalone Markdown profile assets inside the browser-extension product boundary. Separate Titan Zero platform-development, reusable field-service-development, and vertical-development concerns so verticals extend shared contracts instead of creating parallel systems.

**Tech Stack:** Markdown content assets, GitHub repository contents API, existing OpenBrowser agent-profile schema conventions.

## Global Constraints

- Work only on `agent/agent-profile-inventory`.
- Do not modify executable files in `src/` or `browser-extension/src/` during this content pass.
- Every profile must include the full 19-section OpenBrowser profile contract.
- Every profile ID must be unique, kebab-case, schema version `1`, profile version `1.0.0`.
- Profiles build software; they do not operate a field-service business.
- Vertical profiles must reuse field-service domain, workflow, evidence, billing, and scheduling contracts.

---

### Task 1: Titan Zero Development Pack

**Files:**
- Create: `browser-extension/agent-library/titan-zero-development/*.md`

**Interfaces:**
- Consumes: the existing Markdown profile contract and Titan Zero architecture boundaries.
- Produces: 20 independently installable Titan Zero development profile assets.

- [ ] Create all 20 approved profile documents.
- [ ] Check each document for all required sections and unique IDs.
- [ ] Verify the pack contains no operational-business agent responsibilities.
- [ ] Commit the pack.

### Task 2: Reusable Field-Service Development Pack

**Files:**
- Create: `browser-extension/agent-library/field-service-development/*.md`

**Interfaces:**
- Consumes: shared Titan Zero and WorkCore integration boundaries.
- Produces: 22 reusable field-service software-development profile assets.

- [ ] Create all 22 approved reusable field-service profile documents.
- [ ] Ensure job, scheduling, billing, evidence, offline, compliance, asset, and portal responsibilities have one bounded owner each.
- [ ] Verify profiles describe software development rather than live operations.
- [ ] Commit the pack.

### Task 3: Vertical Development Pack

**Files:**
- Create: `browser-extension/agent-library/vertical-development/cleaning/cleaning-vertical-engineer.md`
- Create: `browser-extension/agent-library/vertical-development/airbnb/airbnb-turnover-engineer.md`
- Create: `browser-extension/agent-library/vertical-development/medical-cleaning/medical-cleaning-compliance-engineer.md`

**Interfaces:**
- Consumes: reusable field-service contracts from Task 2.
- Produces: three vertical extensions without duplicate platform authority.

- [ ] Create the three vertical profile documents.
- [ ] State explicit reuse of shared field-service systems.
- [ ] Reject parallel customer, job, schedule, evidence, invoice, and identity stores.
- [ ] Commit the pack.

### Task 4: Catalog Verification and Progress Record

**Files:**
- Create: `.titan/todo/issues/Titan-Zero-Field-Service-Development-Agent-Profile-Progress.md`

**Interfaces:**
- Consumes: all 45 files created in Tasks 1-3.
- Produces: auditable counts, paths, completion boundary, and next runtime-integration work.

- [ ] Compare the branch against the pre-pass commit.
- [ ] Confirm exactly 45 profile files and two planning documents were added before the progress record.
- [ ] Inspect representative files from every pack through GitHub.
- [ ] Record profile counts and remaining runtime-loader work.
- [ ] Run a final branch comparison and report only verified results.