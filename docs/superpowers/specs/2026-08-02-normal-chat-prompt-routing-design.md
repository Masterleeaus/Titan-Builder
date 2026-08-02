# Normal-Chat Prompt Routing Design

## Status

Approved for Pass 06 implementation on 2026-08-02.

## Goal

Apply Titan Builder's canonical development prompts automatically in both ordinary provider chats and Work mode, without imposing Work-mode reply limits on normal conversations or granting normal chat any local execution authority.

## Product boundary

Prompt selection is global. Execution authority remains surface-specific.

- Normal chat may enhance the user's outbound message with one selected prompt and then continues as an ordinary provider conversation.
- Work mode may use the same routing catalog while retaining registered-project context, operation previews, approvals, application, verification, and audit history.
- Neither surface may silently broaden the user's objective.
- The development prompt library must not operate live field-service businesses.

## Architecture

### Shared routing engine

`browser-extension/src/prompt-router.js` remains the only scoring and selection implementation. Both Work and normal chat consume it.

### Chat-specific envelope

`browser-extension/src/chat-prompt-envelope.js` composes the selected canonical body with the original message. It explicitly limits authority to conversation context, uploaded files, connected tools, and capabilities actually available in that provider chat.

### Provider-page interceptor

`browser-extension/src/chat-prompt-routing.js`:

- discovers the active provider composer and send control through `providers.js` selectors;
- intercepts send-button clicks, plain Enter, and form submission in capture phase;
- routes the draft using Ask compatibility;
- lazily resolves the selected canonical Markdown body;
- writes the enhanced message into the existing composer;
- resubmits once using a bounded bypass window;
- submits the original text unchanged for Off, no-match, ambiguity, invalid manual selection, catalog failure, or body-load failure;
- prevents double wrapping;
- provides persistent Auto, Manual, and Off controls plus visible status.

### Bootstrap and packaging

`chat-prompt-bootstrap.js` is a classic Manifest V3 content script loaded after the existing Work content runtime. It dynamically imports the ESM routing module from the extension package.

Only the shared routing modules and canonical Markdown bodies are web-accessible, and only on supported AI-provider origins. No wildcard web origin is permitted.

## Data flow

1. User writes a normal provider-chat message.
2. The interceptor previews or waits for submit.
3. Auto, Manual, or Off settings are read from extension-local storage.
4. The shared catalog and router produce `selected`, `ambiguous`, `none`, `off`, or an explicit error.
5. Selected routes load the exact canonical body and validate its ID through the existing catalog loader.
6. The chat envelope preserves the original message verbatim and appends bounded application rules.
7. The provider's existing send control submits the enhanced message.
8. Later user messages repeat the process independently; provider conversation history remains intact.

## Failure policy

Normal chat fails open to the user's original text because prompt enhancement is advisory and must never trap a message. Every failure is visible in the routing badge. Work-mode safety remains fail-closed at its existing permission and approval boundaries.

## Security

- No new extension permissions.
- No `<all_urls>` resource exposure.
- No `eval`, `new Function`, inline script, or `innerHTML` assignment.
- No access to bridge control credentials from the chat module.
- Prompt text does not grant local writes, shell execution, deployment, approvals, or business operations.
- Existing Work content and background runtimes remain unchanged.

## Testing

Focused tests cover routing settings, automatic selection, ambiguity, no-match, Off, invalid manual IDs, body-load failure, double-wrap prevention, chat envelope authority, keyboard interception, manifest ordering, restricted resources, CSP-safe source, and separation from Work execution.

## Non-goals

- Replacing provider UIs.
- Capturing or storing provider conversations.
- Automatically applying repository changes from ordinary chat.
- Removing the Work surface.
- Adding live business-operation prompts.
