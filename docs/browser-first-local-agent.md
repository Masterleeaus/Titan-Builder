# Browser-First Local Agent

OpenBrowser can now run complete Ask and Agent workflows from the Chrome side panel while the local Node bridge remains the only authority for project access, parsing, planning, approvals, file operations, verification, recovery, and audit history.

## Architecture

The browser extension is a thin user interface and provider-automation client.

It may:

- select an already registered project by project ID;
- create and inspect browser workflow runs;
- display answers, risks, and unified diffs;
- select operations;
- request a short-lived approval capability;
- explicitly confirm final apply;
- reject or cancel a run.

It may not:

- receive or store `BRIDGE_TOKEN`;
- supply an arbitrary filesystem root;
- read or write local project files directly;
- parse model operations;
- plan or execute operations;
- call `/operations/*` or `/session/*` with the browser token;
- reuse an expired, consumed, stale, or restart-invalidated approval capability.

The authoritative service listens only on `127.0.0.1` by default.

## Initial setup

```bash
pnpm install --frozen-lockfile
pnpm run verify
pnpm build
pnpm setup
pnpm link --global
```

Create the secure user configuration if it does not already exist:

```text
~/.openbrowser/.env
```

The bridge requires two distinct credentials:

- `BRIDGE_TOKEN` — privileged CLI and control credential. Never put this in Chrome storage.
- `BRIDGE_BROWSER_TOKEN` — restricted extension credential used by browser, project-intelligence, and browser-workflow routes.

Copy only `BRIDGE_BROWSER_TOKEN` into the extension settings.

## Register a project

From the project directory:

```bash
openbrowser project add .
```

The browser workflow accepts only the resulting `project-...` identifier. Project names and raw paths are deliberately rejected at the browser API boundary.

## Run the bridge

Foreground:

```bash
openbrowser server
```

Detached service:

```bash
openbrowser service start
openbrowser service status
openbrowser service logs --lines 100
openbrowser service stop
```

The service manager:

- rejects an unmanaged process already responding on the configured bridge port;
- requires a successful `/health` response after launch;
- stores PID metadata in `~/.openbrowser/service.json`;
- writes bounded logs to `~/.openbrowser/logs/service.log`;
- rotates an oversized log to `service.log.1`;
- sends a graceful termination signal before force-stopping;
- removes stale PID metadata.

### Windows login startup

Background startup is opt-in:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -EnableBackgroundService
```

This registers a current-user Scheduled Task named **OpenBrowser Local Agent**. Running the installer without the switch does not enable automatic startup.

## Work view

1. Open a supported AI site in Chrome.
2. Open the OpenBrowser side panel.
3. Select **Work**.
4. Select a registered project.
5. Choose **Ask** or **Agent**.
6. Enter the prompt, optional context references, context budget, provider, and verification profile.
7. Start the run.

### Ask

The local service builds safe project context and project memory, sends the prepared request through the existing browser job queue, captures the response, and displays it in the Work view.

### Agent

The local service:

1. builds context;
2. captures and validates model output;
3. creates immutable operation plans;
4. produces risk-labelled diffs;
5. waits for browser review without changing files.

Low-side-effect operations are selected by default. Operations requiring explicit approval—such as destructive, arbitrary-execution, network-write, or publish operations—start unselected and require a separate confirmation.

## Two-stage approval

Approval is intentionally split:

1. Review the complete preview and select operations.
2. Choose **Approve selected**.
3. The service re-plans the selected subset against the current filesystem.
4. The service issues a short-lived, one-time capability bound to:
   - run ID;
   - project root;
   - conversation ID;
   - reviewed preview revision;
   - selected operation IDs;
   - current selected-plan revision;
   - expiry.
5. Choose **Confirm and apply**.
6. The service re-plans again immediately before consuming the capability and executing.

The capability is never written to run snapshots or audit records.

## Stale previews

If any relevant file changes after review or after approval:

- apply is blocked;
- the approval capability is revoked;
- a fresh preview is generated;
- the run returns to `awaiting_approval`;
- the Work view clears the old capability and displays the latest server snapshot;
- the user must review and approve again.

## Recovery

Public run snapshots, private prepared artifacts, and append-only audit events are persisted separately under:

```text
~/.openbrowser/runs/
```

After a service restart:

- context/model preparation states return to `queued` and may resume;
- `awaiting_approval` restores the review snapshot without any approval capability;
- `ready_to_apply` is downgraded to `awaiting_approval`;
- interrupted `applying` or `verifying` states fail closed with `RECOVERY_REVIEW_REQUIRED`;
- file writes are never replayed automatically.

The side panel restores the active run from local storage and refreshes the latest authoritative snapshot. It uses two-second polling as the reliable fallback and ignores stale events from older runs.

## Audit history

Browser workflow events record:

- run creation and selected project;
- status transitions;
- model capture and validation;
- operation preview generation;
- operation selection and risk summary;
- approval preparation metadata excluding the token;
- apply and changed-path results;
- verification outcomes;
- stale-preview recovery;
- restart recovery, rejection, cancellation, and failure.

Sensitive keys such as tokens, authorization values, secrets, passwords, and cookies are redacted. Event summaries and values are length-bounded.

Retrieve a run's audit history with the restricted browser credential:

```text
GET /workspace/runs/:runId/audit
```

## Verification

The repository verification pipeline runs on Linux and Windows and includes:

- TypeScript type checking;
- all Node and integration tests;
- complete browser-first queue/claim/respond/review/approve/apply/verify acceptance coverage;
- CLI and service-command smoke tests;
- extension Work-view, stale-recovery, monitoring, and security tests;
- browser-extension companion typecheck, tests, Python tests, script checks, and build.

A real Chrome smoke test is still recommended before publishing a release because GitHub Actions does not operate an authenticated personal AI browser session.
