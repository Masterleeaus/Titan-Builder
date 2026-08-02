# Browser-First Local Agent Rollout

Implement the complete OpenBrowser Ask and Agent workflow in the Chrome side panel without moving filesystem authority into the extension.

Required delivery:

- reusable local preparation and application services;
- persistent typed browser-run state machine;
- registered-project-only browser API;
- browser-token-only workflow routes with privileged routes remaining control-only;
- Work tab for Ask, Agent, context, provider, verification, diff review, selection, rejection, cancellation, and final apply;
- separate confirmation for high-risk operations;
- short-lived one-time approvals bound to run, project, conversation, preview, and selected operations;
- stale-preview re-planning before approval and immediately before execution;
- detached local service with health, PID, port, log, and graceful-stop handling;
- opt-in current-user Windows Scheduled Task;
- restart recovery that never replays writes and never restores approval capabilities;
- redacted, bounded audit history;
- Linux and Windows CI covering the root application and browser-extension companion;
- complete queue-to-browser-response-to-review-to-apply automated acceptance test;
- operator and recovery documentation.

Release gate:

- both operating-system matrix jobs pass;
- browser extension tests pass;
- privileged token separation remains intact;
- no approval token appears in snapshots or audit history;
- PR receives final code and security review before merging to `main`.
