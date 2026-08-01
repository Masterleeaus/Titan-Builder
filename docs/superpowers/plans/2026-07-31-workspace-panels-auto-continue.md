# Workspace Panels and Auto-Continue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Skills, Agent Profiles, ChatGPT Apps/Plugins, ChatGPT File Library, File Exporter, and Settings panels while adding capped opt-in auto-continue and preserving OpenBrowser security boundaries.

**Architecture:** Extend the existing native side panel with local-first storage models for skills, profiles, settings, and scan results. Reuse the existing background/content-script bridge for prompt routing, add explicit ChatGPT page scans, and inject workspace instructions into side-panel and CLI jobs without granting broader permissions.

**Tech Stack:** Manifest V3, vanilla JavaScript, Chrome Side Panel API, chrome.storage.local, existing TypeScript CLI/server, Node built-in test runner.

## Global Constraints

- Preserve existing supported AI hosts and permissions; do not add `<all_urls>` or `debugger`.
- Do not remove Superpower compatibility filtering.
- Store custom skills, profiles, settings, and scan metadata locally.
- Do not claim official API access to ChatGPT plugin or Library inventories.
- Auto-continue must be opt-in, capped at 1-10 continuations, and limited to OpenBrowser jobs/side-panel prompts.
- Prefer native Continue buttons; optional fallback prompts are allowed only for ask-style responses, never agent JSON operations.
- Do not weaken bridge authentication, CORS, or repository command safety.
- File export must be user-triggered, size-capped, filename-sanitized, and honest when ChatGPT file bytes cannot be fetched.

---

### Task 1: Workspace data models

**Files:**
- Create: `browser-extension/src/workspace-library.js`
- Test: `browser-extension/src/workspace-library.test.mjs`

**Interfaces:**
- Produces built-in skills/profiles, normalizers, active context resolution, and prompt/system-instruction composition.

- [ ] Write failing tests for skill/profile normalization and prompt composition.
- [ ] Run focused tests and confirm RED.
- [ ] Implement minimal workspace models.
- [ ] Run focused tests and confirm GREEN.

### Task 2: Settings and auto-continue policy

**Files:**
- Modify: `browser-extension/src/bridge-config.js`
- Modify: `browser-extension/src/bridge-config.test.mjs`
- Create: `browser-extension/src/auto-continue-policy.js`
- Test: `browser-extension/src/auto-continue-policy.test.mjs`

**Interfaces:**
- Produces normalized auto-continue settings and capped decision helpers available to the content script.

- [ ] Write failing tests for defaults, caps, and native/fallback decisions.
- [ ] Run focused tests and confirm RED.
- [ ] Implement settings and policy.
- [ ] Run focused tests and confirm GREEN.

### Task 3: ChatGPT plugin and Library scan helpers

**Files:**
- Create: `browser-extension/src/chatgpt-page-tools.js`
- Test: `browser-extension/src/chatgpt-page-tools.test.mjs`

**Interfaces:**
- Produces safe text classification and visible-page scanners exposed through `globalThis.OpenBrowserChatGPTTools`.

- [ ] Write failing tests for plugin/file candidate classification and deduplication.
- [ ] Run focused tests and confirm RED.
- [ ] Implement minimal scanners.
- [ ] Run focused tests and confirm GREEN.

### Task 4: Side-panel UI and local CRUD

**Files:**
- Modify: `browser-extension/src/sidepanel.html`
- Modify: `browser-extension/src/sidepanel.css`
- Modify: `browser-extension/src/sidepanel.js`
- Modify: `browser-extension/src/sidepanel-integration.test.mjs`

**Interfaces:**
- Consumes workspace models, bridge config, and ChatGPT scan messages.
- Produces Skills, Agents, Plugins, Library, Settings, Prompts, Custom, and Status views.

- [ ] Write integration assertions for all required tabs and controls.
- [ ] Run tests and confirm RED.
- [ ] Implement UI, CRUD, activation, scans, import/export, and settings persistence.
- [ ] Run tests and confirm GREEN.

### Task 5: Background/content integration

**Files:**
- Modify: `browser-extension/manifest.json`
- Modify: `browser-extension/src/background.js`
- Modify: `browser-extension/src/content-script.js`
- Create: `browser-extension/src/workspace-integration.test.mjs`

**Interfaces:**
- Background adds active workspace instructions to CLI jobs and prompt deliveries.
- Content script scans visible ChatGPT pages and performs capped auto-continue.

- [ ] Write source/integration tests for scan messages, workspace instructions, and auto-continue wiring.
- [ ] Run tests and confirm RED.
- [ ] Implement background/content integration.
- [ ] Run tests and confirm GREEN.


### Task 6: File and conversation exporter

**Files:**
- Create: `browser-extension/src/file-exporter.js`
- Test: `browser-extension/src/file-exporter.test.mjs`
- Modify: `browser-extension/src/sidepanel.html`
- Modify: `browser-extension/src/sidepanel.css`
- Modify: `browser-extension/src/sidepanel.js`
- Modify: `browser-extension/src/content-script.js`

**Interfaces:**
- Exports one, selected, or all scanned files/replies as Markdown or ZIP.
- Fetches visible ChatGPT download URLs only on explicit user action and falls back to metadata Markdown when bytes are unavailable.

- [ ] Write failing tests for filename sanitization, Markdown bundles, ZIP structure, and export selection.
- [ ] Run tests and confirm RED.
- [ ] Implement exporter helpers and explicit page-fetch messages.
- [ ] Add exporter UI for one/selected/all files and conversation replies.
- [ ] Run tests and confirm GREEN.

### Task 7: Documentation, full verification, and packaging

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `package.json`
- Create: `docs/upgrade-workspace-panels-v0.4.md`

- [ ] Document capabilities and limitations.
- [ ] Run all dependency-free tests.
- [ ] Run JavaScript/JSON syntax and permission checks.
- [ ] Review git diff for unrelated changes.
- [ ] Create clean ZIP excluding `.git`, dependencies, and temporary files.
