# Titan Builder Prompt Library Roadmap

## Repository context

- Repository: `Masterleeaus/Titan-Builder`
- Base branch: `main`
- Active batch branch: `feature/prompt-library-batch-04-06`
- Batch base commit: `dce29ffd304718a8ce0092b4f0a0f7f1dfbcf144`
- Current observed `main`: `80bd8640750897cf7d8bb061f0d208f6789c1fc4`
- Batch branch drift: five commits behind current `main`; reconciliation required before the Pass 06 pull request
- Batch passes: Pass 04, Pass 05, and Pass 06
- Batch merge policy: open one pull request and merge only after Pass 06
- Last merged prompt pass branch: `feature/prompt-library-pass-03`
- Pass 01 pull request: `#6`
- Pass 01 merge commit: `cfa0862bc9a9ccf045d360e4fbdbdf3982c0f8c8`
- Pass 02 pull request: `#9`
- Pass 02 merge commit: `0eb8520df0bb1a0b9326f987b54e5ca505b22d92`
- Pass 03 pull request: `#12`
- Pass 03 merge commit: `15d9e785bbc626ec98c2987055f09af5138655e3`
- Canonical prompt authoring location: `browser-extension/prompt-library/`
- Existing extension runtime prompt source: `browser-extension/src/coding-prompts.js`
- Existing prompt utilities: `browser-extension/src/prompt-library.js`
- Existing runtime skill and agent source: `browser-extension/src/workspace-library.js`
- Root runtime: `src/`
- Roadmap status: active
- Last updated: 2026-08-02 Australia/Sydney

## Architecture finding

The root `src/` directory is the Node.js and TypeScript CLI/server runtime. It is not the correct canonical location for standalone Markdown prompts or skills.

The browser extension already owns the user-facing Prompts, Skills, Agents, Custom, and workspace composition surfaces. Canonical standalone prompt documents therefore belong under `browser-extension/prompt-library/`.

Future standalone skills and agents should remain inside the browser-extension boundary. Proposed locations are `browser-extension/skill-library/` and `browser-extension/agent-library/`, while executable loaders and registries remain under `browser-extension/src/`.

## Prompt-library product boundary

The Titan Builder prompt library contains platform-development instructions for AI developer agents, architects, auditors, testers, migration agents, and maintainers.

It may analyse, design, implement, test, migrate, document, or audit Titan Zero, WorkCore, browser-extension, home-service, field-service, cleaning-vertical, and supporting platform code.

It does not operate live service businesses. Prompts whose primary purpose is creating real jobs, dispatching real workers, sending real invoices or messages, recording real attendance, or collecting real payments belong in future Titan Zero operational skill and workflow libraries rather than this development prompt library.

## Pass and merge policy

- Each pass creates three or four closely related standalone prompts.
- Each prompt receives its own duplicate scan, complete specification validation, parser-visible variable review, examples, failure handling, compatibility metadata, Knowledge Capture, and Change Log.
- Three consecutive passes share one batch branch.
- Pass-level commits remain independently reviewable.
- No pull request or merge occurs after the first or second pass in a batch.
- After the third pass, the complete branch receives drift review, CI, pull-request review, and one merge into `main`.
- Blocked or invalid work remains unmerged.

The detailed batching design is stored at:

```text
docs/superpowers/specs/2026-08-02-prompt-library-three-pass-batching-design.md
```

## Status legend

- `PLANNED`: approved catalog entry not yet authored.
- `IN PROGRESS`: current pass is creating or upgrading the prompt.
- `BATCH COMPLETE`: standalone prompt is complete and validated on the active batch branch but not yet merged into `main`.
- `COMPLETE`: standalone Markdown prompt is merged into `main`.
- `SUPERSEDED`: replaced by a newer prompt with a documented migration path.
- `MERGE`: overlaps another planned or existing prompt and will be consolidated.
- `BLOCKED`: cannot proceed until a dependency is resolved.

## Existing built-in prompt inventory

| Existing ID | Existing title | Decision |
|---|---|---|
| `deep-extension-audit` | Deep Extension Audit | Upgrade into `TB-PROMPT-AUDIT-001`; preserve the current card until catalog loading exists. |
| `systematic-debug` | Systematic Bug Debugger | Upgrade into `TB-PROMPT-DEBUG-001`. |
| `implement-feature-tdd` | Implement Feature with TDD | Upgrade into `TB-PROMPT-DEV-001`. |
| `review-diff` | Review Current Diff | Upgrade into `TB-PROMPT-REVIEW-001`. |
| `repair-tests` | Repair Failing Tests | Upgrade into `TB-PROMPT-TEST-001`. |
| `security-boundary-review` | Browser Security Boundary Review | Upgrade into `TB-PROMPT-SEC-001`. |
| `architecture-simplify` | Simplify Architecture | Upgrade into `TB-PROMPT-ARCH-004`. |
| `manifest-v3-lifecycle` | Manifest V3 Lifecycle Check | Upgrade into `TB-PROMPT-AUDIT-002`. |
| `provider-adapter-update` | Repair AI Provider Adapter | Upgrade into `TB-PROMPT-EXT-001`. |
| `git-ready-pass` | Prepare a Git-Ready Pass | Upgrade into `TB-PROMPT-GIT-001`. |
| `document-system` | Document a Subsystem | Upgrade into `TB-PROMPT-DOC-001`. |
| `performance-audit` | Extension Performance Audit | Upgrade into `TB-PROMPT-PERF-001`. |

No existing built-in card is deleted during Markdown authoring. Runtime replacement occurs only after the catalog loader and compatibility migration are implemented and tested.

## Planned prompt catalog

### Foundation and Prompt Governance

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-FOUND-001` | Repository Architecture Discovery | P0 | None | COMPLETE — merged in PR `#6` |
| `TB-PROMPT-FOUND-002` | Prompt Duplicate and Overlap Detection | P0 | FOUND-001 | COMPLETE — merged in PR `#9` |
| `TB-PROMPT-FOUND-003` | Prompt Specification Validation | P0 | FOUND-001 | COMPLETE — merged in PR `#12` |
| `TB-PROMPT-FOUND-004` | Multi-Provider Prompt Compatibility Audit | P1 | FOUND-003 | BATCH COMPLETE — Pass 04 |
| `TB-PROMPT-FOUND-005` | Prompt Semantic Version Upgrade | P1 | FOUND-002, FOUND-003 | BATCH COMPLETE — Pass 04 |
| `TB-PROMPT-FOUND-006` | Prompt Library Metadata Index Generation | P1 | FOUND-003 | PLANNED |
| `TB-PROMPT-FOUND-007` | Prompt Installability Verification | P1 | FOUND-003, FOUND-006 | PLANNED |
| `TB-PROMPT-PROMPT-001` | Production Prompt Template Generator | P0 | FOUND-003 | PLANNED |
| `TB-PROMPT-PROMPT-002` | Existing Prompt Refactor and Supersession | P1 | FOUND-002, FOUND-005 | PLANNED |

### Titan Zero Platform Development

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-TZ-ARCH-001` | Titan Zero and WorkCore Authority Boundary Audit | P0 | FOUND-001 | BATCH COMPLETE — Pass 04 |
| `TB-PROMPT-TZ-AI-001` | Five-Tier AI Runtime Design and Implementation | P0 | TZ-ARCH-001, TEST-002 | PLANNED |
| `TB-PROMPT-TZ-ACTION-001` | Governed AI Action and Approval Infrastructure | P0 | TZ-ARCH-001, SEC-001 | PLANNED |
| `TB-PROMPT-TZ-MEM-001` | Business Memory and Context Architecture | P1 | TZ-ARCH-001, ARCH-002 | PLANNED |
| `TB-PROMPT-TZ-CONF-001` | Confidence, Approval, and Human-Override Pipeline | P1 | TZ-ACTION-001 | PLANNED |
| `TB-PROMPT-TZ-OFFLINE-001` | Device-First Offline Projection and Sync Architecture | P0 | TZ-ARCH-001, SEC-001 | PLANNED |
| `TB-PROMPT-TZ-OMNI-001` | Omnichannel Identity and Conversation Infrastructure | P1 | TZ-ARCH-001 | PLANNED |
| `TB-PROMPT-TZ-UI-001` | Template-Aware Generative Workspace Architecture | P1 | TZ-ARCH-001 | PLANNED |
| `TB-PROMPT-TZ-SIGNAL-001` | Signal, Telemetry, and Operational Awareness Architecture | P1 | TZ-ARCH-001 | PLANNED |
| `TB-PROMPT-TZ-REWIND-001` | Audit History, Rewind, and Recovery Architecture | P1 | TZ-ARCH-001, TZ-ACTION-001 | PLANNED |
| `TB-PROMPT-TZ-SEC-001` | Tenant, Permission, Secret, and AI Trust-Boundary Audit | P0 | TZ-ARCH-001, SEC-001 | PLANNED |
| `TB-PROMPT-TZ-SPROUT-001` | Titan Sprout Vertical-Builder Architecture | P1 | TZ-ARCH-001 | PLANNED |
| `TB-PROMPT-TZ-INTEGRATION-001` | Titan Zero and WorkCore Integration Conformance Audit | P0 | TZ-ARCH-001 | PLANNED |

### Home and Field-Service Platform Development

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-FIELD-ARCH-001` | Home and Field-Service Platform Architecture Audit | P0 | FOUND-001, TZ-ARCH-001 | BATCH COMPLETE — Pass 04 |
| `TB-PROMPT-FIELD-DOMAIN-001` | Field-Service Domain and WorkCore Entity Mapping | P0 | FIELD-ARCH-001 | PLANNED |
| `TB-PROMPT-FIELD-JOB-001` | Field-Service Job Lifecycle Subsystem Design and Implementation | P0 | FIELD-ARCH-001, TEST-002 | PLANNED |
| `TB-PROMPT-FIELD-SCHED-001` | Scheduling, Dispatch, Routing, and Reassignment Architecture | P0 | FIELD-ARCH-001 | PLANNED |
| `TB-PROMPT-FIELD-MOBILE-001` | Field-Worker Mobile and Tablet Interface Implementation | P0 | FIELD-ARCH-001, FIELD-JOB-001 | PLANNED |
| `TB-PROMPT-FIELD-OFFLINE-001` | Offline Job Pack, Queue, Sync, and Conflict Implementation | P0 | FIELD-ARCH-001, TZ-OFFLINE-001 | PLANNED |
| `TB-PROMPT-FIELD-PROOF-001` | Photo, Signature, Form, and Proof-of-Service Infrastructure | P1 | FIELD-ARCH-001 | PLANNED |
| `TB-PROMPT-FIELD-VOICE-001` | Voice Capture and Field Command Infrastructure | P1 | FIELD-MOBILE-001 | PLANNED |
| `TB-PROMPT-FIELD-VAR-001` | Job Variation Capture and Approval Infrastructure | P1 | FIELD-JOB-001, TZ-ACTION-001 | PLANNED |
| `TB-PROMPT-FIELD-BILLING-001` | Job Completion and Billing-Handoff Integration | P1 | FIELD-JOB-001, TZ-ARCH-001 | PLANNED |
| `TB-PROMPT-FIELD-COMP-001` | Compliance, Certificate, and Evidence Infrastructure | P1 | FIELD-PROOF-001 | PLANNED |
| `TB-PROMPT-FIELD-TEST-001` | Field-Service End-to-End Regression Test Generation | P0 | FIELD-JOB-001, FIELD-SCHED-001 | PLANNED |
| `TB-PROMPT-FIELD-MIG-001` | Donor Field-Service Module Conversion and WorkCore Migration | P1 | FIELD-ARCH-001, MIG-001 | PLANNED |
| `TB-PROMPT-FIELD-REVIEW-001` | Field-Service Feature Completeness and Runtime Reachability Audit | P0 | FIELD-ARCH-001 | PLANNED |

### Cleaning Vertical Platform Development

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-CLEAN-ARCH-001` | Cleaning Vertical Domain Architecture Audit | P1 | FIELD-ARCH-001 | PLANNED |
| `TB-PROMPT-CLEAN-TEMPLATE-001` | Cleaning Room, Surface, Task, and Service Template Schema | P1 | CLEAN-ARCH-001 | PLANNED |
| `TB-PROMPT-CLEAN-ATP-001` | ATP Testing and Hygiene Certification Feature Implementation | P1 | CLEAN-ARCH-001, FIELD-COMP-001 | PLANNED |
| `TB-PROMPT-CLEAN-MIG-001` | Donor Module Terminology and Cleaning-Domain Migration | P1 | CLEAN-ARCH-001, FIELD-MIG-001 | PLANNED |
| `TB-PROMPT-CLEAN-TEST-001` | Cleaning Vertical Regression Test Design | P1 | CLEAN-TEMPLATE-001, TEST-002 | PLANNED |

### Architecture

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-ARCH-001` | Runtime Entry Point Mapping | P0 | FOUND-001 | PLANNED |
| `TB-PROMPT-ARCH-002` | State Ownership Mapping | P1 | ARCH-001 | PLANNED |
| `TB-PROMPT-ARCH-003` | Dependency Boundary Audit | P1 | ARCH-001 | PLANNED |
| `TB-PROMPT-ARCH-004` | Duplicate Runtime Consolidation | P1 | ARCH-001, ARCH-002, ARCH-003 | PLANNED — upgrades `architecture-simplify` |
| `TB-PROMPT-ARCH-005` | Architecture Decision Record Generation | P2 | ARCH-001 | PLANNED |

### Development

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-DEV-001` | Focused Feature Implementation with TDD | P0 | TEST-002 | PLANNED — upgrades `implement-feature-tdd` |
| `TB-PROMPT-DEV-002` | API Contract Implementation | P1 | ARCH-003 | PLANNED |
| `TB-PROMPT-DEV-003` | Data Model Change Implementation | P1 | ARCH-002, TEST-002 | PLANNED |
| `TB-PROMPT-DEV-004` | Browser Extension Feature Wiring | P1 | ARCH-001, AUDIT-002 | PLANNED |
| `TB-PROMPT-DEV-005` | Backwards-Compatible Configuration Change | P2 | FOUND-005 | PLANNED |

### Debugging

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-DEBUG-001` | Reproducible Defect Root-Cause Analysis | P0 | None | PLANNED — upgrades `systematic-debug` |
| `TB-PROMPT-DEBUG-002` | Asynchronous Race Condition Investigation | P1 | DEBUG-001 | PLANNED |
| `TB-PROMPT-DEBUG-003` | State Persistence Defect Investigation | P1 | DEBUG-001, ARCH-002 | PLANNED |
| `TB-PROMPT-DEBUG-004` | Cross-Layer Integration Failure Investigation | P1 | DEBUG-001, ARCH-001 | PLANNED |

### Testing

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-TEST-001` | Failing Test Root-Cause Repair | P0 | DEBUG-001 | PLANNED — upgrades `repair-tests` |
| `TB-PROMPT-TEST-002` | Behavioural Regression Test Design | P0 | None | PLANNED |
| `TB-PROMPT-TEST-003` | Test Coverage Gap Analysis | P1 | ARCH-001 | PLANNED |
| `TB-PROMPT-TEST-004` | Flaky Test Evidence Investigation | P1 | TEST-001 | PLANNED |

### Audit and Review

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-AUDIT-001` | Browser Extension Runtime Deep Audit | P0 | ARCH-001 | PLANNED — upgrades `deep-extension-audit` |
| `TB-PROMPT-AUDIT-002` | Manifest V3 Lifecycle Audit | P0 | ARCH-001 | PLANNED — upgrades `manifest-v3-lifecycle` |
| `TB-PROMPT-REVIEW-001` | Change-Set Defect Review | P0 | None | PLANNED — upgrades `review-diff` |
| `TB-PROMPT-REVIEW-002` | Architecture Conformance Review | P1 | ARCH-001, ARCH-003 | PLANNED |
| `TB-PROMPT-REVIEW-003` | Release Candidate Review | P1 | DEPLOY-001 | PLANNED |

### Security

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-SEC-001` | Extension and Local Bridge Trust-Boundary Review | P0 | ARCH-001 | PLANNED — upgrades `security-boundary-review` |
| `TB-PROMPT-SEC-002` | Input, Path, and Command Validation Audit | P0 | SEC-001 | PLANNED |
| `TB-PROMPT-SEC-003` | Secret Exposure and Credential Handling Review | P1 | SEC-001 | PLANNED |
| `TB-PROMPT-SEC-004` | Permission and Least-Privilege Review | P1 | SEC-001 | PLANNED |

### Extension and Performance

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-EXT-001` | AI Provider Adapter Repair | P0 | AUDIT-002, TEST-002 | PLANNED — upgrades `provider-adapter-update` |
| `TB-PROMPT-EXT-002` | Extension Message Contract Audit | P1 | ARCH-001, SEC-001 | PLANNED |
| `TB-PROMPT-PERF-001` | Browser Extension Performance Audit | P1 | ARCH-001 | PLANNED — upgrades `performance-audit` |
| `TB-PROMPT-PERF-002` | Memory and Retention Growth Audit | P1 | ARCH-002 | PLANNED |

### Migration and Refactoring

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-MIG-001` | Backwards-Compatible Module Migration | P1 | ARCH-001, FOUND-005 | PLANNED |
| `TB-PROMPT-MIG-002` | Data Migration Safety Plan | P1 | DEV-003, TEST-002 | PLANNED |
| `TB-PROMPT-REF-001` | Large Module Decomposition | P1 | ARCH-002, ARCH-003 | PLANNED |
| `TB-PROMPT-REF-002` | Dead Code Evidence Audit | P1 | ARCH-001 | PLANNED |

### Planning, Workflow, and Automation

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-PLAN-001` | Evidence-Based Implementation Plan Generation | P0 | FOUND-001 | PLANNED |
| `TB-PROMPT-PLAN-002` | Platform Migration Plan Generation | P1 | MIG-001 | PLANNED |
| `TB-PROMPT-WORKFLOW-001` | Deterministic SOP Workflow Generation | P1 | PLAN-001 | PLANNED |
| `TB-PROMPT-WORKFLOW-002` | Release Workflow Generation | P1 | GIT-001, DEPLOY-001 | PLANNED |
| `TB-PROMPT-AUTO-001` | GitHub Actions Workflow Generation | P1 | TEST-002, SEC-002 | PLANNED |
| `TB-PROMPT-AUTO-002` | Scheduled Automation Design | P2 | WORKFLOW-001 | PLANNED |

### Git, Deployment, and Release

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-GIT-001` | Git-Ready Branch and Pull Request Preparation | P0 | REVIEW-001 | PLANNED — upgrades `git-ready-pass` |
| `TB-PROMPT-DEPLOY-001` | Release Readiness Gate | P1 | REVIEW-001, SEC-001, TEST-003 | PLANNED |
| `TB-PROMPT-DEPLOY-002` | Deployment Rollback Plan | P1 | DEPLOY-001 | PLANNED |

### Research and Evaluation

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-RESEARCH-001` | Official Documentation Technical Research | P1 | None | PLANNED |
| `TB-PROMPT-RESEARCH-002` | Comparative Technology Evaluation | P1 | RESEARCH-001 | PLANNED |

### Documentation and Reporting

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-DOC-001` | Evidence-Based Subsystem Documentation | P0 | ARCH-001 | PLANNED — upgrades `document-system` |
| `TB-PROMPT-DOC-002` | API Reference Documentation | P1 | DEV-002 | PLANNED |
| `TB-PROMPT-REPORT-001` | Evidence-Based Audit Report | P1 | REVIEW-001 | PLANNED |
| `TB-PROMPT-REPORT-002` | Incident Postmortem Report | P1 | DEBUG-001 | PLANNED |

### Agent and Skill Creation

| ID | Name | Priority | Dependencies | Status |
|---|---|---:|---|---|
| `TB-PROMPT-AGENT-001` | Specialised Agent Profile Generation | P1 | FOUND-003 | PLANNED |
| `TB-PROMPT-SKILL-001` | Production Skill Generation | P1 | FOUND-003 | PLANNED |

## Implementation order

1. Continue the active Pass 04–06 batch without merging until Pass 06.
2. Complete the remaining foundation and governance prompts required for catalog generation and installability.
3. Build generic architecture, testing, and security prompts that support Titan Zero and field-service work.
4. Build Titan Zero authority, action, offline, security, memory, UI, and integration prompts in dependency order.
5. Build shared field-service domain, job, scheduling, mobile, offline, proof, billing-handoff, compliance, migration, and test prompts.
6. Build cleaning-vertical prompts as extensions of the shared field-service architecture rather than replacements for it.
7. Implement the Markdown catalog index and loader as a dedicated code migration only after governance dependencies are complete.
8. Upgrade existing built-in prompt cards into standalone documents in dependency order.
9. Replace code-embedded prompt bodies only after loader compatibility and regression tests pass.

## Prompt catalog loader dependency

A future migration pass must create a deterministic loader before the Markdown library becomes the side-panel runtime source. The migration must preserve current APIs and user data. Until then:

- Markdown files are the canonical authoring and version-history source.
- Existing JavaScript prompt cards remain the runtime source.
- New Markdown prompts are not claimed to be visible in the side panel.

## Pass 01 completion

- [x] Resolve repository and create `feature/prompt-library-pass-01` from the then-current `main`.
- [x] Inspect root `src/`, extension runtime, prompt utilities, skills, agents, manifest, tests, and prior plans.
- [x] Determine canonical prompt placement.
- [x] Create architecture design.
- [x] Create implementation plan.
- [x] Create this cumulative roadmap.
- [x] Create `TB-PROMPT-FOUND-001`.
- [x] Review the branch diff: four added Markdown files and no runtime changes.
- [x] Verify the branch through OpenBrowser, Linux workspace, and Windows workspace CI.
- [x] Open pull request `#6`.
- [x] Merge pull request `#6` into `main`.

## Pass 02 completion

- [x] Resolve current `main` and create `feature/prompt-library-pass-02`.
- [x] Search canonical, runtime, system, documentation, and roadmap prompt locations for duplicate-detection capability.
- [x] Confirm no existing standalone prompt performs deterministic duplicate and overlap classification.
- [x] Create the Pass 02 implementation plan.
- [x] Create `TB-PROMPT-FOUND-002` version `1.0.0`.
- [x] Update this cumulative roadmap.
- [x] Perform the final structural and Superpowers review.
- [x] Correct undeclared illustrative template tokens before publication.
- [x] Review the exact branch diff: one prompt, one plan, and one roadmap update; Markdown only.
- [x] Open pull request `#9`.
- [x] Verify the branch through the repair gate, full OpenBrowser verification, existing-application verification, Linux workspace verification, and Windows workspace verification.
- [x] Merge pull request `#9` into `main` at `0eb8520df0bb1a0b9326f987b54e5ca505b22d92`.

## Pass 03 completion

- [x] Resolve current `main` and create `feature/prompt-library-pass-03`.
- [x] Search repository prompt locations for an existing specification-validation prompt.
- [x] Confirm no standalone prompt validates one candidate against the complete Titan Builder prompt-document contract.
- [x] Create the Pass 03 implementation plan.
- [x] Create `TB-PROMPT-FOUND-003` version `1.0.0`.
- [x] Update this cumulative roadmap.
- [x] Perform parser-aware variable and required-section validation.
- [x] Perform final Superpowers consistency review.
- [x] Review the exact branch diff: one prompt, one plan, and one roadmap update; Markdown only.
- [x] Open pull request `#12`.
- [x] Verify the branch through the repair gate, full OpenBrowser verification, existing-application verification, Linux workspace verification, and Windows workspace verification.
- [x] Merge pull request `#12` into `main` at `15d9e785bbc626ec98c2987055f09af5138655e3`.

## Pass 04 completion on batch branch

- [x] Resolve latest `main` and create `feature/prompt-library-batch-04-06` from `dce29ffd304718a8ce0092b4f0a0f7f1dfbcf144`.
- [x] Add and self-review the three-pass batching design.
- [x] Search canonical, runtime, system, documentation, and roadmap locations for all four Pass 04 objectives.
- [x] Confirm no standalone provider-compatibility audit exists.
- [x] Confirm no standalone prompt semantic-version upgrade workflow exists.
- [x] Confirm no standalone Titan Zero and WorkCore authority-boundary audit exists.
- [x] Confirm no standalone home and field-service platform architecture audit exists.
- [x] Create the Pass 04 implementation plan.
- [x] Create `TB-PROMPT-FOUND-004` version `1.0.0`.
- [x] Create `TB-PROMPT-FOUND-005` version `1.0.0`.
- [x] Create `TB-PROMPT-TZ-ARCH-001` version `1.0.0`.
- [x] Create `TB-PROMPT-FIELD-ARCH-001` version `1.0.0`.
- [x] Preserve developer-agent platform scope and exclude live business operations.
- [x] Add Titan Zero, field-service, and cleaning-vertical platform-development roadmap categories.
- [x] Update the pass and merge policy to three or four prompts per pass and one merge every three passes.
- [x] Complete parser-aware structural verification for all four prompts: required sections, IDs, paths, versions, variables, Change Logs, placeholder scan, and score arithmetic.
- [x] Review the exact Pass 04 branch delta: four prompts, one design, one plan, and one roadmap update; Markdown only.
- [x] Inspect five intervening `main` commits and confirm they do not modify the prompt library or its roadmap.
- [x] Deliberately do not open a pull request or merge after Pass 04.

## Active batch continuation

- Pass 05 must continue from `feature/prompt-library-batch-04-06`.
- Pass 06 must continue from the same branch.
- Before the Pass 06 pull request, reconcile the branch with current `main`, including the skill-registry/runtime changes merged after the batch base.
- The batch pull request and merge occur only after Pass 06 and successful full verification.
