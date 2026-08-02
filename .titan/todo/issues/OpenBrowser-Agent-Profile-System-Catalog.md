# OpenBrowser Agent Profile System Catalog

- Status: PLANNED
- Branch: `agent/agent-profile-inventory`
- Repository: `Masterleeaus/Titan-Builder`
- Scan scope: `browser-extension/` and `src/`
- Objective: define the complete set of narrow, production-ready agent profiles that will be installed in the OpenBrowser/Titan Builder system.

## Deep-scan findings

OpenBrowser currently has two cooperating execution domains:

1. `browser-extension/` owns browser-provider interaction, side-panel profile selection, Chrome-local profile storage, job enrichment, prompt delivery, response capture, visible ChatGPT scans, exports, and browser job recovery.
2. `src/` owns CLI orchestration, bridge sessions, context generation, system prompts, response parsing, project memory, project registration, file-operation planning and execution, structured tools, risk approval, verification, and terminal output.

The current built-in profile registry is located in `browser-extension/src/workspace-library.js`. It contains four profiles:

- `coding-agent`
- `extension-auditor`
- `test-engineer`
- `release-reviewer`

The existing profile schema contains only:

- `id`
- `name`
- `role`
- `instructions`
- `skillIds`
- `custom`

That schema is too small for the required production profile format. The future shared profile model must support:

- Identity
- Purpose
- Expertise
- Responsibilities
- Tools
- Permissions
- Memory scope
- Communication style
- Decision strategy
- Strengths
- Weaknesses
- Escalation rules
- Approval requirements
- Skills
- Prompt templates
- Validation rules
- Success metrics
- Version

Profiles are currently selected in the side panel, persisted in `chrome.storage.local`, resolved with their default skills, and injected into both side-panel prompts and CLI-created browser jobs. The implementation must preserve this behaviour while moving the canonical profile definitions into a versioned shared registry usable by both the extension and local runtime.

## Target profile catalog

Every profile below has one bounded primary responsibility. General-purpose profiles are excluded.

### A. Local runtime and orchestration

#### 1. Bridge Runtime Engineer

- Canonical ID: `bridge-runtime-engineer`
- Primary job: diagnose and repair the Fastify bridge, authenticated routes, SSE transport, and extension-to-local communication.
- Main code domain: `src/server/`, `src/client/`, bridge security configuration.
- Initial default skills: `debugging`, `testing`, `security`.

#### 2. Session Lifecycle Engineer

- Canonical ID: `session-lifecycle-engineer`
- Primary job: maintain job creation, claim leases, heartbeats, recovery, stale-response rejection, completion, timeout, and cancellation semantics.
- Main code domain: session store, browser job lifecycle, background recovery logic.
- Initial default skills: `debugging`, `testing`, `architecture`.

#### 3. Context Engineer

- Canonical ID: `context-engineer`
- Primary job: build accurate, budgeted project context and resolve `@file` and `@folder` references without leaking excluded data.
- Main code domain: `src/context/`.
- Initial default skills: `architecture`, `testing`, `performance`.

#### 4. Prompt Protocol Engineer

- Canonical ID: `prompt-protocol-engineer`
- Primary job: own ask-mode and agent-mode instruction protocols, workspace instruction composition, delivery markers, and prompt compatibility.
- Main code domain: `src/prompts/system.ts`, `browser-extension/src/job-payload.js`.
- Initial default skills: `architecture`, `testing`, `security`.

#### 5. Response Parser Engineer

- Canonical ID: `response-parser-engineer`
- Primary job: parse model replies into valid operations and file bodies while rejecting malformed, ambiguous, or mismatched output.
- Main code domain: `src/parser/`, protocol schemas.
- Initial default skills: `debugging`, `testing`, `security`.

#### 6. File Operations Engineer

- Canonical ID: `file-operations-engineer`
- Primary job: plan, preview, apply, order, roll back, and audit filesystem operations safely.
- Main code domain: `src/operations/`.
- Initial default skills: `debugging`, `testing`, `security`, `git`.

#### 7. Tool Contract Engineer

- Canonical ID: `tool-contract-engineer`
- Primary job: define and validate structured tool schemas, risk classes, arguments, input-file integrity, permissions, and idempotency.
- Main code domain: `src/tools/registry.ts`, operation protocol.
- Initial default skills: `architecture`, `security`, `testing`.

#### 8. Verification Engineer

- Canonical ID: `verification-engineer`
- Primary job: detect and execute approved quick, standard, and full repository verification plans.
- Main code domain: `src/verification/` and package-script detection.
- Initial default skills: `testing`, `debugging`, `git`.

#### 9. Project Registry Engineer

- Canonical ID: `project-registry-engineer`
- Primary job: manage persistent project registration, active-project resolution, root validation, and project metadata consistency.
- Main code domain: `src/projects/`.
- Initial default skills: `architecture`, `testing`, `security`.

#### 10. Agent Memory Engineer

- Canonical ID: `agent-memory-engineer`
- Primary job: govern explicit project memory, retrieval, retention, conflict handling, deletion, and prompt inclusion.
- Main code domain: `src/memory/` and side-panel memory views.
- Initial default skills: `security`, `architecture`, `testing`.

#### 11. Configuration Engineer

- Canonical ID: `configuration-engineer`
- Primary job: own environment loading, bridge settings, defaults, precedence, validation, secret references, and configuration migration.
- Main code domain: `src/config/`, `browser-extension/src/bridge-config.js`.
- Initial default skills: `security`, `testing`, `architecture`.

#### 12. Observability Engineer

- Canonical ID: `observability-engineer`
- Primary job: make bridge, CLI, session, tool, browser, and verification behaviour diagnosable through structured events and correlation identifiers.
- Main code domain: server logging, terminal tracking, browser service-worker diagnostics.
- Initial default skills: `debugging`, `performance`, `architecture`.

### B. Browser extension and provider integration

#### 13. Browser Automation Engineer

- Canonical ID: `browser-automation-engineer`
- Primary job: implement deterministic browser interactions using resilient locators, state-based waits, and authoritative completion signals.
- Main code domain: content scripts and provider interaction logic.
- Initial default skills: `debugging`, `testing`, `performance`.

#### 14. Provider Adapter Engineer

- Canonical ID: `provider-adapter-engineer`
- Primary job: maintain one provider adapter's composer discovery, file attachment, send action, response detection, and compatibility behaviour.
- Main code domain: provider routing and provider-specific content-script logic.
- Initial default skills: `debugging`, `testing`, `architecture`.

#### 15. Extension Runtime Engineer

- Canonical ID: `extension-runtime-engineer`
- Primary job: maintain Manifest V3 service-worker lifecycle, alarms, reconnection, tab registration, dispatch, recovery, and Chrome permission behaviour.
- Main code domain: `browser-extension/manifest.json`, `browser-extension/src/background.js`.
- Initial default skills: `debugging`, `testing`, `performance`, `security`.

#### 16. Workspace Profile Engineer

- Canonical ID: `workspace-profile-engineer`
- Primary job: own profile and skill schemas, registries, activation, persistence, import/export, versioning, prompt composition, and migration.
- Main code domain: `browser-extension/src/workspace-library.js`, side-panel agent and skill views, future shared registry in `src/`.
- Initial default skills: `architecture`, `testing`, `security`.

#### 17. Side-Panel UX Engineer

- Canonical ID: `side-panel-ux-engineer`
- Primary job: maintain the coding workspace side panel, profile selection, prompt library, project views, settings, status, and user feedback states.
- Main code domain: `browser-extension/src/sidepanel.html`, `sidepanel.js`, and styles.
- Initial default skills: `testing`, `performance`, `architecture`.

#### 18. Export and Library Engineer

- Canonical ID: `export-library-engineer`
- Primary job: manage visible ChatGPT file/reply scanning, selection, Markdown export, ZIP creation, host restrictions, size limits, and fallback records.
- Main code domain: ChatGPT page tools and file exporter.
- Initial default skills: `security`, `testing`, `performance`.

#### 19. Auto-Continue Policy Engineer

- Canonical ID: `auto-continue-policy-engineer`
- Primary job: enforce bounded continuation rules, truncation detection, native-button preference, fallback restrictions, and agent-mode exclusions.
- Main code domain: auto-continue policy and content-script continuation flow.
- Initial default skills: `security`, `testing`, `architecture`.

#### 20. Accessibility Tester

- Canonical ID: `accessibility-tester`
- Primary job: test side-panel and popup workflows for keyboard, focus, semantics, accessible names, errors, and dynamic announcements.
- Main code domain: extension HTML, JavaScript interaction states, and accessibility tests.
- Initial default skills: `testing`.

#### 21. Browser Performance Engineer

- Canonical ID: `browser-performance-engineer`
- Primary job: measure and reduce observer, timer, rendering, storage, message, and service-worker overhead in the extension.
- Main code domain: browser-extension runtime and UI.
- Initial default skills: `performance`, `testing`, `debugging`.

### C. Security, quality, governance, and delivery

#### 22. Security Auditor

- Canonical ID: `security-auditor`
- Primary job: identify exploitable weaknesses across browser content, prompt injection, bridge authentication, origins, paths, tools, approvals, secrets, and exports.
- Main code domain: cross-cutting.
- Initial default skills: `security`, `architecture`, `testing`.

#### 23. Data Privacy Auditor

- Canonical ID: `data-privacy-auditor`
- Primary job: audit collection, local storage, memory, logs, prompts, visible-page scans, exports, retention, and deletion of personal or sensitive data.
- Main code domain: cross-cutting data flows.
- Initial default skills: `security`, `architecture`.

#### 24. Testing Engineer

- Canonical ID: `testing-engineer`
- Primary job: design deterministic unit, integration, contract, and browser regression tests for one assigned component.
- Main code domain: `src/**/*.test.ts`, `browser-extension/src/*.test.mjs`, integration suites.
- Initial default skills: `testing`, `debugging`.

#### 25. Code Reviewer

- Canonical ID: `code-reviewer`
- Primary job: review one bounded change for correctness, security, compatibility, maintainability, and test adequacy.
- Main code domain: change-specific.
- Initial default skills: `git`, `security`, `testing`, `architecture`.

#### 26. Dependency Auditor

- Canonical ID: `dependency-auditor`
- Primary job: audit package necessity, versions, transitive risk, advisories, licensing, maintenance, and upgrade compatibility.
- Main code domain: `package.json`, lockfiles, imports, build scripts.
- Initial default skills: `security`, `testing`, `git`.

#### 27. Documentation Engineer

- Canonical ID: `documentation-engineer`
- Primary job: maintain accurate, executable documentation for one component, command, workflow, API, or release.
- Main code domain: `README.md`, `pid.md`, `docs/`, issue evidence.
- Initial default skills: `architecture`, `testing`, `git`.

#### 28. Release Manager

- Canonical ID: `release-manager`
- Primary job: verify exact release scope, artefact provenance, tests, extension integrity, versioning, changelog, rollout, and rollback evidence.
- Main code domain: package metadata, release scripts, workflows, extension packaging.
- Initial default skills: `git`, `testing`, `security`, `architecture`.

#### 29. Incident Response Coordinator

- Canonical ID: `incident-response-coordinator`
- Primary job: coordinate severity, evidence, containment, communication, recovery criteria, timeline, and corrective actions for one active incident.
- Main code domain: operational evidence across the system.
- Initial default skills: `debugging`, `security`, `git`.

#### 30. Component Architect

- Canonical ID: `component-architect`
- Primary job: define ownership, contracts, invariants, failure boundaries, and migration paths for one bounded OpenBrowser subsystem.
- Main code domain: assigned subsystem only.
- Initial default skills: `architecture`, `security`, `testing`.

#### 31. Workflow Designer

- Canonical ID: `workflow-designer`
- Primary job: design one deterministic human-agent workflow with states, approvals, retries, evidence, cancellation, and compensation.
- Main code domain: CLI, extension, and operational workflow specifications.
- Initial default skills: `architecture`, `security`, `testing`.

#### 32. Technical Research Analyst

- Canonical ID: `technical-research-analyst`
- Primary job: answer one narrowly scoped implementation, standards, compatibility, or provider question using current primary evidence.
- Main code domain: research output only unless separately authorised.
- Initial default skills: `architecture`.

## Legacy profile migration

The four current profiles must not remain as broad duplicate authorities.

| Current profile | Migration |
| --- | --- |
| `coding-agent` | Deprecate as a selectable implementation profile. Retain temporarily as a compatibility alias that routes users to the most relevant narrow implementation profile. |
| `extension-auditor` | Replace with `extension-runtime-engineer`, `browser-automation-engineer`, `security-auditor`, and `browser-performance-engineer` depending on task scope. |
| `test-engineer` | Migrate directly to `testing-engineer` with a compatibility alias. |
| `release-reviewer` | Split into `code-reviewer` for change review and `release-manager` for release readiness and packaging. |

## Required implementation work

1. Create a shared, versioned profile schema usable by both `src/` and `browser-extension/`.
2. Store canonical built-in profiles outside UI code; the side panel should consume the registry rather than own it.
3. Preserve custom profile support while adding schema versioning and migration.
4. Extend the side-panel profile editor or provide read-only full-profile detail for built-ins.
5. Keep exactly one active profile, while allowing multiple active skills.
6. Validate profile IDs, versions, permissions, memory scope, approval rules, prompt templates, and default skill references.
7. Ensure active profile content reaches every side-panel prompt and every CLI-created browser job in both text and attachment delivery modes.
8. Add compatibility aliases for the four legacy built-ins and prevent duplicate display entries.
9. Add profile import/export with schema-version checks and safe rejection of invalid definitions.
10. Add tests for registry loading, schema validation, activation, persistence, migration, prompt composition, text delivery, file delivery, and stale-profile replacement.
11. Add filtering by domain and responsibility so thirty-two profiles remain usable in the side panel.
12. Add documentation describing how profiles differ from skills, prompts, tools, and workflows.

## Validation rules

- Every built-in profile defines all required profile sections.
- Every profile has one primary job and explicit non-responsibilities.
- Every tool and permission claim maps to an implemented capability or is marked future/unavailable.
- Every default skill ID resolves to an installed skill.
- Profile memory scope does not silently expand project or user data retention.
- Approval requirements are preserved when profile instructions are composed with the agent system prompt.
- Profile instructions cannot weaken bridge security, operation validation, risk classification, or user confirmation.
- The active profile is applied once, not duplicated across recovered or continued jobs.
- Custom profiles cannot override canonical built-in IDs.
- Schema migrations are deterministic and covered by tests.
- Legacy aliases preserve saved user selections without retaining broad duplicate profiles.

## Success criteria

- Thirty-two canonical narrow profiles are represented in the shared registry.
- The four legacy profiles migrate without breaking saved workspace state.
- Extension and local runtime use the same authoritative profile definitions.
- One active profile and multiple active skills are consistently applied to side-panel and CLI jobs.
- Invalid, outdated, or permission-escalating profile definitions are rejected safely.
- Profile selection remains understandable through domain filters and concise summaries.
- All profile registry, migration, persistence, and prompt-delivery tests pass.
- Full repository verification and Manifest V3 extension integrity checks pass before release.
