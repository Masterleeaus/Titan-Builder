# Normal-Chat Prompt Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route ordinary provider-chat messages through the same canonical prompt selector used by Work while preserving normal conversation behaviour and surface-specific authority.

**Architecture:** Add a chat-specific envelope and provider-page interceptor that import the existing catalog and router. Load them through a small content-script bootstrap and expose only required extension resources to supported provider origins.

**Tech Stack:** Manifest V3, browser content scripts, JavaScript ESM, Chrome storage, Node test runner.

## Global Constraints

- Keep `prompt-router.js` as the single scoring implementation.
- Normal chat must never assume a registered project or local write authority.
- Work execution and approval code must remain unchanged.
- Auto, Manual, and Off modes are required.
- Ambiguity and all routing failures must submit the original message unchanged.
- No broad host permissions or CSP exceptions.

---

### Task 1: Chat routing contract

**Files:**
- Create: `browser-extension/src/chat-prompt-routing.test.mjs`
- Create: `browser-extension/src/chat-prompt-envelope.js`
- Create: `browser-extension/src/chat-prompt-routing.js`

**Interfaces:**
- Consumes: `routePromptRequest(request, catalog, options)`, `getRuntimePromptCatalog()`, `resolvePromptBody(record, loader)`.
- Produces: `composeRoutedChatPrompt(input)`, `normalizeChatRoutingSettings(input)`, `prepareChatPrompt(input)`, `isAlreadyRoutedChatPrompt(text)`, `shouldInterceptChatKeydown(event, composer)`.

- [x] Write failing tests for auto selection, fallback, failures, double wrapping, authority, and keyboard interception.
- [x] Run the focused test and verify missing-module failure.
- [x] Implement the minimum chat envelope and pure routing preparation functions.
- [x] Run focused tests and verify green.

### Task 2: Provider-page interception

**Files:**
- Create: `browser-extension/src/chat-prompt-bootstrap.js`
- Modify: `browser-extension/src/chat-prompt-routing.js`

**Interfaces:**
- Consumes provider input/send selectors from `providers.js` and extension-local routing settings.
- Produces `installChatPromptRouting(options)` with capture-phase click, keydown, and submit interception.

- [x] Add capture-phase provider submission interception.
- [x] Add bounded bypass to prevent recursive submission.
- [x] Add Auto, Manual, and Off controls in a Shadow DOM host.
- [x] Add visible selected, ambiguous, no-match, and error status.
- [x] Re-query the provider send control after composer replacement.

### Task 3: Manifest and packaging integration

**Files:**
- Modify: `browser-extension/manifest.json`
- Create: `browser-extension/src/chat-prompt-integration.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Bootstrap dynamically imports `src/chat-prompt-routing.js`.
- Web-accessible resources are restricted to supported AI-provider matches.

- [x] Load bootstrap after existing content execution.
- [x] Expose only routing modules and canonical prompt bodies.
- [x] Register both new tests in `test:node`.
- [x] Verify no `<all_urls>`, inline script, `eval`, `new Function`, or `innerHTML` use.

### Task 4: Verification and batch handoff

**Files:**
- Create: `.titan/todo/issues/prompt-library-pass-06.md`
- Update draft PR #30 after the detached commit can be attached.

- [x] Run the two focused Node test files.
- [x] Run `node --check` on new JavaScript modules.
- [x] Parse `manifest.json` and `package.json`.
- [ ] Run full repository CI after GitHub permits the detached commit to become the branch head.
- [ ] Reconcile current `main` without merge commits.
- [ ] Mark the PR ready and squash/rebase merge the three-pass batch once.
