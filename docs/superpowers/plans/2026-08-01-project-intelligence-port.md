# Project Intelligence Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port AI Coding Studio's most mature project-context concepts into OpenBrowser as persistent named projects, explicit project memory, context budgets, and portable project bundles.

**Architecture:** Extend OpenBrowser's existing `.openbrowser` memory and context modules rather than introducing a parallel runtime. CLI commands remain authoritative for local filesystem work, while the side panel consumes bridge endpoints and Chrome local storage only for user-visible project selection and preview. All context collection remains repository-bounded, secret-aware, size-capped, and previewable.

**Tech Stack:** Node.js 22, TypeScript, Fastify bridge, Chrome Manifest V3 side panel, Node test runner.

## Global Constraints

- Preserve the current safe-tool registry and approval boundaries.
- Never include `.env`, credentials, private keys, `.git`, `node_modules`, or generated build folders in context or exports.
- Keep all local project writes inside the selected project root or the user-level OpenBrowser project registry.
- Do not add `<all_urls>`, debugger permissions, wildcard CORS, or arbitrary shell execution.
- Use deterministic JSON and Markdown formats that remain human-editable.
- Version the release as `0.5.0`.

---

### Task 1: Project registry and active project metadata

**Files:**
- Create: `src/projects/registry.ts`
- Create: `src/projects/registry.test.ts`
- Modify: `src/memory/index.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `ProjectRecord`, `listProjects()`, `registerProject()`, `resolveProject()`, `removeProject()`, `setActiveProject()`, `getActiveProject()`.

- [ ] Write failing tests for canonical path deduplication, safe naming, active project persistence, and missing project errors.
- [ ] Implement the registry under the user configuration directory.
- [ ] Add `openbrowser project add|list|show|use|remove` commands.
- [ ] Run focused and full offline tests.

### Task 2: Explicit project memory

**Files:**
- Create: `src/memory/project-memory.ts`
- Create: `src/memory/project-memory.test.ts`
- Modify: `src/memory/index.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `ProjectMemoryEntry`, `listProjectMemory()`, `addProjectMemory()`, `removeProjectMemory()`, `clearProjectMemory()`, `formatProjectMemory()`.

- [ ] Write failing tests for normalization, deduplication, safe persistence, removal, and Markdown formatting.
- [ ] Implement memory storage in `.openbrowser/memory.json`.
- [ ] Add `openbrowser memory add|list|remove|clear` commands.
- [ ] Include active project memory in ask and agent prompts.

### Task 3: Budgeted context collection and preview

**Files:**
- Create: `src/context/context-budget.ts`
- Create: `src/context/context-budget.test.ts`
- Modify: `src/context/file-context.ts`
- Modify: `src/context/index.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `ContextBudget`, `ContextBudgetItem`, `buildBudgetedContext()`, `formatContextBudgetPreview()`.

- [ ] Write failing tests for priorities, total limits, per-file limits, secret-path exclusion, truncation and deterministic selection.
- [ ] Refactor existing context attachment loading to expose candidates before content loading.
- [ ] Add `--budget <characters>` and `--context <path...>` to ask/agent.
- [ ] Add `openbrowser context preview` and `openbrowser context export`.

### Task 4: Portable project bundle

**Files:**
- Create: `src/projects/bundle.ts`
- Create: `src/projects/bundle.test.ts`
- Modify: `src/index.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: `exportProjectBundle()`, `importProjectBundle()`, `ProjectBundleManifest`.

- [ ] Write failing tests for deterministic bundle contents, sensitive-file exclusion and safe import validation.
- [ ] Export project metadata, memory, context summary, prompts, history and settings to a portable directory or ZIP-compatible staging folder.
- [ ] Add CLI export/import commands.
- [ ] Document the new workflow and security boundaries.

### Task 5: Side-panel Projects and Memory views

**Files:**
- Create: `browser-extension/src/project-intelligence.js`
- Create: `browser-extension/src/project-intelligence.test.mjs`
- Modify: `browser-extension/src/sidepanel.html`
- Modify: `browser-extension/src/sidepanel.js`
- Modify: `browser-extension/src/sidepanel.css`
- Modify: `src/server/index.ts`

**Interfaces:**
- Produces bridge endpoints for project list/status, memory CRUD and context preview.

- [ ] Write failing browser tests for project normalization, memory formatting and context preview rendering.
- [ ] Add Projects and Memory tabs.
- [ ] Add explicit context preview with included, truncated and excluded items.
- [ ] Keep all local filesystem changes server-side and token authenticated.

### Task 6: Release verification

**Files:**
- Modify: `package.json`
- Modify: `browser-extension/manifest.json`
- Modify: `scripts/check-extension.mjs`
- Create: `docs/upgrade-project-intelligence-v0.5.md`

- [ ] Update versions to `0.5.0`.
- [ ] Add all new dependency-free tests to `test:node`.
- [ ] Run the full offline suite, extension checks, TypeScript syntax checks and archive checks.
- [ ] Commit and package a clean release archive.
