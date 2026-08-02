# OpenBrowser v0.4.2 — End-to-End Coding Workflow Pass

This pass strengthens the complete CLI-to-browser lifecycle rather than adding more surface features.

## Session recovery and ownership

Browser jobs now use short-lived claim leases. A page that claims a job receives a unique claim token and renews the lease while it is processing the AI response. Chunks, errors, and final responses are accepted only from the current claim token.

If Chrome, the content script, or the extension service worker stops after dispatch, the server makes the expired job dispatchable again. The extension asks the server for pending jobs after every bridge reconnect and during its keepalive cycle.

## Immediate dispatch acknowledgement

The content script acknowledges a background dispatch as soon as the job is queued locally. The background service worker no longer waits for the entire AI response through a single `chrome.tabs.sendMessage` call.

## Safer retry boundaries

AI response parsing may still be retried when the returned schema is invalid. File-operation execution and post-change verification are not retried through the model. This prevents an execution failure from causing the same edits to be generated and applied a second time.

## Verification commands

Run detected repository checks without asking the browser model:

```powershell
openbrowser verify --profile quick
openbrowser verify --profile standard
openbrowser verify --profile full
```

Run verification automatically after an agent change:

```powershell
openbrowser agent "Repair the background bridge" --verify standard
```

Profiles use only approved package scripts:

- `quick`: focused test or check script
- `standard`: typecheck, test, and build where present
- `full`: repository `verify` script when available, otherwise check/lint/typecheck/test/build

## Response timing

The CLI and browser page now allow up to 15 minutes for a completed browser-AI response. The CLI also maintains an idle timeout that is reset by bridge traffic and SSE heartbeats.

Configure the limits in `~/.openbrowser/.env`:

```env
OPENBROWSER_RESPONSE_TIMEOUT_MS=900000
OPENBROWSER_RESPONSE_IDLE_TIMEOUT_MS=180000
```

## Test coverage

The pass adds dependency-free tests for:

- exclusive claim leases
- expired-job recovery
- claim renewal and release
- stale-token rejection
- response timeout bounds
- verification profile planning
- immediate extension dispatch acknowledgement
- pending-job recovery wiring

A dependency-backed Fastify integration test covers prompt creation, pending discovery, claim, heartbeat, streaming chunk, final completion, and terminal session status.
