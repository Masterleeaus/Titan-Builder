# Titan Builder Prompt Library Roadmap

## Repository context

- Repository: `Masterleeaus/Titan-Builder`
- Base branch: `main`
- Current pass branch: `feature/prompt-library-pass-01`
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

## Status legend

- `PLANNED`: approved catalog entry not yet authored.
- `IN PROGRESS`: current branch is creating or upgrading the prompt.
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
| `TB-PROMPT-FOUND-001` | Repository Architecture Discovery | P0 | None | IN PROGRESS — pass 01 |
| `TB-PROMPT-FOUND-002` | Prompt Duplicate and Overlap Detection | P0 | FOUND-001 | PLANNED |
| `TB-PROMPT-FOUND-003` | Prompt Specification Validation | P0 | FOUND-001 | PLANNED |
| `TB-PROMPT-FOUND-004` | Multi-Provider Prompt Compatibility Audit | P1 | FOUND-003 | PLANNED |
| `TB-PROMPT-FOUND-005` | Prompt Semantic Version Upgrade | P1 | FOUND-002, FOUND-003 | PLANNED |
| `TB-PROMPT-FOUND-006` | Prompt Library Metadata Index Generation | P1 | FOUND-003 | PLANNED |
| `TB-PROMPT-FOUND-007` | Prompt Installability Verification | P1 | FOUND-003, FOUND-006 | PLANNED |
| `TB-PROMPT-PROMPT-001` | Production Prompt Template Generator | P0 | FOUND-003 | PLANNED |
| `TB-PROMPT-PROMPT-002` | Existing Prompt Refactor and Supersession | P1 | FOUND-002, FOUND-005 | PLANNED |

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

1. Complete foundation and governance prompts.
2. Implement the Markdown catalog index and loader as a dedicated code migration pass.
3. Upgrade existing built-in prompt cards into standalone documents in dependency order.
4. Add architecture, testing, and security prompts before broader development prompts.
5. Add workflow, automation, release, documentation, agent, and skill generation prompts.
6. Replace code-embedded prompt bodies only after loader compatibility and regression tests pass.

## Prompt catalog loader dependency

A future migration pass must create a deterministic loader before the Markdown library becomes the side-panel runtime source. The migration must preserve current APIs and user data. Until then:

- Markdown files are the canonical authoring and version-history source.
- Existing JavaScript prompt cards remain the runtime source.
- New Markdown prompts are not claimed to be visible in the side panel.

## Pass 01 checklist

- [x] Resolve repository and create `feature/prompt-library-pass-01` from latest `main`.
- [x] Inspect root `src/`, extension runtime, prompt utilities, skills, agents, manifest, tests, and prior plans.
- [x] Determine canonical prompt placement.
- [x] Create architecture design.
- [x] Create implementation plan.
- [x] Create this cumulative roadmap.
- [ ] Create `TB-PROMPT-FOUND-001`.
- [ ] Review branch diff.
- [ ] Open pull request.
- [ ] Merge into `main`.
