# Coding Side Panel and Prompt Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a safe coding-focused Chrome side panel and local prompt library to OpenBrowser without importing debugger access, security-header stripping, broad all-site permissions, or API dependencies.

**Architecture:** Extend the existing Manifest V3 bridge extension with a native HTML/CSS/JavaScript side panel. The panel stores built-in and user prompts in `chrome.storage.local`, expands `${variable:default}` templates, and routes prompts through the existing provider adapters and content scripts. The background worker remains the only coordinator for tab selection and provider routing.

**Tech Stack:** Chrome Manifest V3, vanilla JavaScript modules, HTML/CSS, `chrome.sidePanel`, `chrome.storage`, existing OpenBrowser provider adapters.

## Global Constraints

- Preserve the existing OpenBrowser CLI and safe coding command runtime.
- Do not add React, WXT, API keys, external prompt APIs, `<all_urls>`, `debugger`, or CSP-bypass behaviour.
- Keep Superpower compatibility enabled and avoid selecting extension-injected ChatGPT controls.
- Prompt sending must target only existing supported AI host permissions.
- User prompts remain local and support export/import.

---

### Task 1: Prompt Template Utilities

**Files:**
- Create: `browser-extension/src/prompt-library.js`
- Test: `browser-extension/src/prompt-library.test.mjs`

**Interfaces:**
- Produces: `parseTemplateVariables(content)`, `applyTemplateVariables(content, values)`, `filterPrompts(prompts, query, category)`, `normalizeCustomPrompt(value)`.

- [x] Write failing tests for variable parsing, expansion, prompt filtering, and invalid custom prompts.
- [x] Run tests and confirm failure.
- [x] Implement the minimal pure utility module.
- [x] Run tests and confirm pass.

### Task 2: Side Panel Shell and Local Prompt Library

**Files:**
- Create: `browser-extension/src/sidepanel.html`
- Create: `browser-extension/src/sidepanel.css`
- Create: `browser-extension/src/sidepanel.js`
- Create: `browser-extension/src/coding-prompts.js`
- Modify: `browser-extension/manifest.json`
- Modify: `browser-extension/src/popup.html`
- Modify: `browser-extension/src/popup.js`

**Interfaces:**
- Consumes: prompt utilities from Task 1.
- Produces: searchable prompt cards, template-variable editor, custom prompt CRUD, JSON import/export, bridge/provider status, and Open Side Panel action.

- [x] Add the side panel manifest declaration and permission.
- [x] Add built-in coding prompt definitions.
- [x] Build side-panel UI with Prompts, Custom, and Status views.
- [x] Persist custom prompts and panel preferences in local storage.
- [x] Add prompt import/export and copy controls.
- [x] Add an Open Side Panel control to the popup.

### Task 3: Safe Prompt Routing Through Existing Provider Adapters

**Files:**
- Modify: `browser-extension/src/background.js`
- Modify: `browser-extension/src/content-script.js`
- Test: `browser-extension/src/prompt-routing.test.mjs`

**Interfaces:**
- Produces: `OPENBROWSER_USE_PROMPT` runtime message and `OPENBROWSER_PROMPT` tab message.
- Prompt payload: `{ prompt: string, provider?: string, submit?: boolean }`.

- [x] Write failing pure routing tests for supported provider preference and fallback.
- [x] Implement provider tab selection in the background worker.
- [x] Add content-script prompt insertion and optional submit handling.
- [x] Return structured success and error results to the panel.

### Task 4: Documentation and Verification

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Create: `docs/upgrade-coding-sidepanel-prompts.md`
- Modify: `package.json`

**Interfaces:**
- Produces: version `0.3.0` and a documented local-only prompt workflow.

- [x] Document side-panel setup, prompt library, Superpower compatibility, and security boundaries.
- [x] Add new dependency-free tests to `test:node`.
- [x] Run all Node tests.
- [x] Validate JavaScript syntax and JSON manifests.
- [x] Review permissions and confirm no broad or debugger permissions were added.
- [x] Package a clean ZIP from the verified commit.
