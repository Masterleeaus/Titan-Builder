# Browser-First Local Agent Rollout — Completed

The browser-first local agent workflow is implemented and verified.

Delivered:

- reusable Ask and Agent preparation services;
- selected-operation application and structured verification service;
- persistent typed browser-run state machine;
- registered-project-only browser workflow API;
- strict browser-token versus control-token route separation;
- Chrome Work view with project, context, provider, verification, risk, diff, selection, rejection, cancellation, and apply controls;
- separate confirmation for high-risk operations;
- short-lived one-time approvals bound to run, project, conversation, browser preview, selected operation IDs, selected-plan revision, and expiry;
- stale preview detection before approval and immediately before execution;
- detached local service with PID metadata, loopback health checks, unmanaged-port rejection, bounded logs, rotation, and graceful shutdown escalation;
- opt-in current-user Windows Scheduled Task;
- restart recovery that discards approval capabilities and never replays writes;
- redacted append-only audit history;
- real queue/claim/respond/review/approve/apply/verify automated acceptance coverage;
- Linux and Windows verification matrix covering both the root application and browser-extension companion;
- operator, recovery, security, and rollout documentation.

Security confirmation:

- `BRIDGE_TOKEN` is not used by the extension;
- browser credentials cannot invoke `/operations/*` or `/session/*`;
- the extension does not parse, plan, or execute file operations;
- approval tokens are absent from public snapshots and audit records;
- stale and restarted runs require review rather than replaying writes;
- the legacy OB-009 auto-repair workflow is excluded only from this implementation branch so it cannot overwrite the verified browser-first source tree.

Verification gate:

- root TypeScript, tests, build, CLI smoke, and extension checks passed;
- browser-extension companion TypeScript, Vitest, Python, script, and build checks passed;
- Linux and Windows matrix jobs passed;
- the complete browser-first integration test passed.

A manual authenticated Chrome/provider smoke test remains a recommended release-validation step because CI does not operate a user's personal signed-in AI browser session.
