# OpenBrowser Safe Coding Pass 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make OpenBrowser safer and more useful for coding by replacing unrestricted default shell execution with structured tools, adding Git-aware status, and making the browser bridge configurable and authenticated.

**Architecture:** Keep the existing CLI → loopback Fastify bridge → Chrome extension flow. Add a focused tool registry inside the operations layer, keep legacy `RUN_COMMAND` behind an explicit environment opt-in, and centralise bridge configuration in extension storage so port and token are applied to HTTP and SSE requests.

**Tech Stack:** TypeScript, Node.js 20+, Fastify, Zod, Commander, Chrome Manifest V3, Vitest.

## Global Constraints

- Preserve existing `ask` and `agent` CLI behaviour.
- Keep the bridge bound to `127.0.0.1` by default.
- Do not expose arbitrary shell execution by default.
- Do not weaken browser extension permissions or CSP.
- Keep changes compatible with Windows, macOS, and Linux.
- Do not add a frontend framework to the browser extension.

---

### Task 1: Structured Safe Tool Registry

**Files:**
- Create: `src/tools/registry.ts`
- Modify: `src/core/types/index.ts`
- Modify: `src/core/enums/index.ts`
- Modify: `src/protocol/index.ts`
- Modify: `src/operations/index.ts`
- Modify: `src/operations/operation-order.ts`
- Modify: `src/parser/markdown-agent.ts`
- Modify: `src/prompts/system.ts`
- Modify: `src/shared/terminal.ts`
- Test: `src/tools/registry.test.ts`

**Interfaces:**
- Produces: `resolveToolInvocation(toolId, args, projectRoot)` returning an executable, argv, cwd, risk level, and display command.
- Produces: `ToolId`, `ToolRisk`, and `ToolInvocation` types.
- Consumes: existing operation planning and execution flow.

- [x] Write failing tests for allowed tools, invalid arguments, shell metacharacter rejection, and legacy command blocking.
- [x] Run the focused tests and confirm they fail because the registry does not exist.
- [x] Implement the minimal safe registry for Git status/diff/log/branch, npm/pnpm scripts, typecheck, tests, builds, and VS Code opening.
- [x] Add `RUN_TOOL` to the operation protocol and route it through argv-based `spawn`, not a shell.
- [x] Keep `RUN_COMMAND` disabled unless `OPENBROWSER_ALLOW_UNSAFE_COMMANDS=1`.
- [x] Update agent prompt instructions to prefer `RUN_TOOL`.
- [x] Run focused and full tests.

### Task 2: Git-Aware Project Status

**Files:**
- Create: `src/project/status.ts`
- Modify: `src/index.ts`
- Test: `src/project/status.test.ts`

**Interfaces:**
- Produces: `readProjectStatus(projectRoot)` returning repository, branch, dirty state, changed file count, remote, and package manager.
- Produces CLI command: `openbrowser status`.

- [x] Write failing tests using a temporary Git repository.
- [x] Run the tests and confirm expected failure.
- [x] Implement project-status detection using argv-based Git execution.
- [x] Add formatted CLI output without modifying repository state.
- [x] Run focused and full tests.

### Task 3: Configurable Authenticated Browser Bridge

**Files:**
- Create: `browser-extension/src/bridge-config.js`
- Modify: `browser-extension/src/background.js`
- Modify: `browser-extension/src/popup.html`
- Modify: `browser-extension/src/popup.js`
- Modify: `browser-extension/src/popup.css`
- Modify: `src/server/index.ts`
- Modify: `src/server/sse-hub.ts`
- Modify: `.env.example`
- Test: `src/server/security.test.ts`

**Interfaces:**
- Produces extension settings: `bridgePort`, `bridgeToken`, `preferredProvider`, and `superpowerCompatibility`.
- Produces server helper: origin validation for extension and origin-less CLI requests.

- [x] Write failing server tests for rejected web origins and token-protected browser routes.
- [x] Run tests and confirm expected failures.
- [x] Implement strict bridge-origin validation and token authentication on browser endpoints when a token is configured.
- [x] Add extension storage-backed bridge URL and Authorization headers for fetch and SSE.
- [x] Add popup controls to save port, token, provider preference, and compatibility mode.
- [x] Run focused and full tests.

### Task 4: Verification and Packaging

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Create: `docs/upgrade-safe-coding-pass1.md`

**Interfaces:**
- Documents installation, safe-tool IDs, legacy unsafe-command opt-in, bridge token setup, and Superpower coexistence.

- [ ] Run typecheck. _(Blocked here because dependencies could not be downloaded in the offline execution environment.)_
- [x] Run unit tests.
- [ ] Run production build. _(Blocked here because dependencies could not be downloaded in the offline execution environment.)_
- [x] Inspect Git diff for unrelated changes.
- [x] Create an upgraded ZIP excluding `.git`, `node_modules`, and generated temporary files.
