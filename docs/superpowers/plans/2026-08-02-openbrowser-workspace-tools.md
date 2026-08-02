# OpenBrowser Workspace Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing browser extension with a secure local workspace companion and developer-tooling bundle directly inside `browser-extension/` without duplicating or weakening the existing OpenBrowser bridge.

**Architecture:** The extension root remains `browser-extension/`, where `manifest.json` and the browser runtime already live. A companion Fastify service in that same extension package binds to loopback on port 5010, stores auxiliary workspace data in SQLite, and proxies selected operations to the authenticated main bridge. All filesystem and command operations are contained to the active project and use argument-array process execution.

**Tech Stack:** Node.js 22, TypeScript, Fastify, better-sqlite3, WebSocket, chokidar, Zod, yazl, Python 3 AST, PowerShell 7, Bash, pnpm.

## Global Constraints

- Keep the existing extension manifest, service worker, content scripts, side panel, popup, and provider runtime intact.
- Keep the main Fastify bridge on port 5000 authoritative for browser sessions, memory, operation approval, and project registry.
- Bind the companion to `127.0.0.1` by default and require `WORKSPACE_TOKEN` for non-health routes.
- Never interpolate request values into shell commands.
- Canonicalize and contain every requested path beneath the active project root.
- Preserve all existing repository verification commands.
- Add all requested developer-tooling files directly under `browser-extension/`.

---

### Task 1: Package and database foundation

**Files:**
- Create: `browser-extension/package.json`
- Create: `browser-extension/tsconfig.json`
- Create: `browser-extension/pnpm-workspace.yaml`
- Create: `browser-extension/schema.sql`
- Create: `browser-extension/seed-db.ts`

- [x] Define exact scripts and dependencies.
- [x] Create normalized SQLite schema with constraints and indexes.
- [x] Add deterministic, explicit seed command.

### Task 2: Secure companion service

**Files:**
- Create: `browser-extension/bridge-server.ts`
- Create: `browser-extension/bridge-server.test.ts`

- [x] Write tests for bearer authentication, root containment, export-name validation, and registration.
- [x] Implement loopback Fastify server, WebSocket broadcasts, SQLite project/index storage, bounded context, safe ripgrep search, Python analysis, staged analysis, ZIP export, and bridge proxies.
- [x] Run `pnpm test`, `pnpm typecheck`, and `pnpm build` in the extension package.

### Task 3: Python analyzer

**Files:**
- Create: `browser-extension/analysis_tools.py`
- Create: `browser-extension/tests/test_analysis_tools.py`

- [x] Add Python AST analysis with valid import extraction and source-line-aware findings.
- [x] Test parse errors, complexity, security findings, and ignored directories.

### Task 4: Windows and dashboard tooling

**Files:**
- Create: `browser-extension/openbrowser.ps1`
- Create: `browser-extension/dashboard.ps1`

- [x] Add start/stop/status/restart/register/search/analyze/install-hook commands.
- [x] Track only the process started by the script; never kill arbitrary port owners.
- [x] Add resilient command/version detection and token headers.

### Task 5: GitHub, hooks, and VS Code integration

**Files:**
- Create: `browser-extension/gh-openbrowser`
- Create: `browser-extension/hooks/pre-commit`
- Create: `browser-extension/.vscode/tasks.json`
- Create: `browser-extension/.vscode/code-snippets.code-snippets`

- [x] Implement only endpoints present in the companion service.
- [x] Build JSON with jq instead of shell string construction.
- [x] Make the hook opt-in blocking through `OPENBROWSER_HOOK_BLOCK=1`.
- [x] Add cross-platform VS Code tasks and snippets.

### Task 6: Documentation and CI

**Files:**
- Create: `browser-extension/README.md`
- Create: `browser-extension/.env.example`
- Create: `.github/workflows/workspace-tools.yml`

- [x] Document setup, tokens, ports, route boundaries, hook installation, and limitations.
- [x] Run companion TypeScript tests/build and Python tests in CI.
- [x] Run existing repository `pnpm run verify` unchanged.
- [ ] Merge the corrective PR only after the corrected `browser-extension/` layout is verified on Linux and Windows.
