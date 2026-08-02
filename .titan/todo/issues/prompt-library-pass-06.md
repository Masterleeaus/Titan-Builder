# Prompt Library Pass 06 — Shared Normal-Chat Routing

## Status

`COMPLETE_ON_BATCH_BRANCH_PENDING_CI`

## Objective

Enable the same deterministic prompt catalog and router in ordinary ChatGPT, Claude, Gemini, DeepSeek, Perplexity, GLM, and Grok conversations without inheriting Work-mode reply limits or execution authority.

## Delivered

- Chat-specific routed prompt envelope with no registered-project assumption.
- Shared use of the existing prompt router and runtime catalog.
- Provider-page interception for send clicks, plain Enter, and form submission.
- Auto, Manual, and Off chat routing modes persisted in extension-local storage.
- Visible selected-prompt, confidence, ambiguity, no-match, disabled, and error status.
- Canonical body loading with existing catalog/body ID verification.
- Original-message fallback for ambiguity, no-match, Off, invalid manual ID, routing failure, and body-load failure.
- Double-wrap prevention and bounded resubmission bypass.
- Restricted Manifest V3 web-accessible resources for supported AI-provider origins only.
- Separation from Work project registration, operation parsing, approval, application, and verification.

## Verification

Passed locally:

```text
node --test browser-extension/src/chat-prompt-routing.test.mjs browser-extension/src/chat-prompt-integration.test.mjs
13 tests passed, 0 failed
```

Also passed:

```text
node --check browser-extension/src/chat-prompt-routing.js
node --check browser-extension/src/chat-prompt-envelope.js
node --check browser-extension/src/chat-prompt-bootstrap.js
python -m json.tool browser-extension/manifest.json
python -m json.tool package.json
```

## Batch state

- Pass 04: complete.
- Pass 05: attached to the batch branch.
- Pass 06: attached to the batch branch pending full CI.
- Draft PR: `#30`.
- Merge policy: one merge after Pass 06 only.

## Remaining gate

Run full repository CI on the final batch head, reconcile current `main` without prohibited merge commits, then mark the PR ready and merge the three-pass batch once.
