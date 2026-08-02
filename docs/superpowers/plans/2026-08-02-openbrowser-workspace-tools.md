# OpenBrowser Workspace Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure local workspace companion and developer-tooling bundle under `tools/openbrowser-workspace/` without duplicating or weakening the existing OpenBrowser bridge.

**Architecture:** A standalone Fastify companion binds to loopback on port 5010, stores auxiliary workspace data in SQLite, and proxies selected operations to the authenticated main bridge. All filesystem and command operations are contained to the active project and use argument-array process execution.

**Tech Stack:** Node.js 22, TypeScript, Fastify, better-sqlite3, WebSocket, chokidar, Zod, yazl, Python 3 AST, PowerShell 7, Bash, pnpm.

## Global Constraints

- Keep the main Fastify bridge on port 5000 authoritative for browser sessions, memory, operation approval, and project registry.
- Bind the companion to `127.0.0.1` by default and require `WORKSPACE_TOKEN` for non-health routes.
- Never interpolate request values into shell commands.
- Canonicalize and contain every requested path beneath the active project root.
- Preserve all existing repository verification commands.
- Add all requested developer-tooling files under `tools/openbrowser-workspace/`.

---

### Task 1: Package and database foundation

**Files:**
- Create: `tools/openbrowser-workspace/package.json`
- Create: `tools/openbrowser-workspace/tsconfig.json`
- Create: `tools/openbrowser-workspace/pnpm-workspace.yaml`
- Create: `tools/openbrowser-workspace/schema.sql`
- Create: `tools/openbrowser-workspace/seed-db.ts`

- [ ] Define exact scripts and dependencies.
- [ ] Create normalized SQLite schema with constraints and indexes.
- [ ] Add deterministic, explicit seed command.
- [ ] Commit: `feat(workspace): add package and database foundation`.

### Task 2: Secure companion service

**Files:**
- Create: `tools/openbrowser-workspace/bridge-server.ts`
- Create: `tools/openbrowser-workspace/bridge-server.test.ts`

- [ ] Write tests for bearer authentication, root containment, export-name validation, and registration.
- [ ] Implement loopback Fastify server, WebSocket broadcasts, SQLite project/index storage, bounded context, safe ripgrep search, Python analysis, staged analysis, ZIP export, and bridge proxies.
- [ ] Run `pnpm test`, `pnpm typecheck`, and `pnpm build` in the companion package.
- [ ] Commit: `feat(workspace): add secure companion bridge`.

### Task 3: Python analyzer

**Files:**
- Create: `tools/openbrowser-workspace/analysis_tools.py`
- Create: `tools/openbrowser-workspace/tests/test_analysis_tools.py`

- [ ] Add Python AST analysis with valid import extraction and source-line-aware findings.
- [ ] Test parse errors, complexity, security findings, and ignored directories.
- [ ] Commit: `feat(workspace): add Python code analysis`.

### Task 4: Windows and dashboard tooling

**Files:**
- Create: `tools/openbrowser-workspace/openbrowser.ps1`
- Create: `tools/openbrowser-workspace/dashboard.ps1`

- [ ] Add start/stop/status/restart/register/search/analyze/install-hook commands.
- [ ] Track only the process started by the script; never kill arbitrary port owners.
- [ ] Add resilient command/version detection and token headers.
- [ ] Commit: `feat(workspace): add PowerShell management tools`.

### Task 5: GitHub, hooks, and VS Code integration

**Files:**
- Create: `tools/openbrowser-workspace/gh-openbrowser`
- Create: `tools/openbrowser-workspace/hooks/pre-commit`
- Create: `tools/openbrowser-workspace/.vscode/tasks.json`
- Create: `tools/openbrowser-workspace/.vscode/code-snippets.code-snippets`

- [ ] Implement only endpoints present in the companion service.
- [ ] Build JSON with jq instead of shell string construction.
- [ ] Make the hook opt-in blocking through `OPENBROWSER_HOOK_BLOCK=1`.
- [ ] Add cross-platform VS Code tasks and snippets.
- [ ] Commit: `feat(workspace): add editor and GitHub integrations`.

### Task 6: Documentation and CI

**Files:**
- Create: `tools/openbrowser-workspace/README.md`
- Create: `tools/openbrowser-workspace/.env.example`
- Create: `.github/workflows/workspace-tools.yml`

- [ ] Document setup, tokens, ports, route boundaries, hook installation, and limitations.
- [ ] Run companion TypeScript tests/build and Python tests in CI.
- [ ] Run existing repository `pnpm run verify` unchanged.
- [ ] Open a draft PR to `main` with evidence and remaining risks.
