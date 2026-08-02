# Browser Install Readiness

## Objective

Make the merged browser-first OpenBrowser workflow practical to install, diagnose, and validate on a real Windows workstation without weakening the local bridge security boundary.

## Scope

- read-only `openbrowser doctor` diagnostics;
- deterministic pass, warning, and failure checks;
- secret-free human and JSON reports;
- Windows installer execution independent of the caller's working directory;
- root runtime and `browser-extension/` companion installation and verification;
- Python prerequisite validation;
- secure credential preservation and missing-token generation;
- opt-in background Scheduled Task;
- canonical unpacked-extension path output;
- disposable-project Chrome smoke checklist;
- Ask, Agent, review, approval, apply, verification, stale-preview, restart, cancellation, and credential-separation validation;
- Linux and Windows CI.

## Security requirements

- `openbrowser doctor` must not modify configuration, services, projects, or files.
- Neither human nor JSON diagnostics may include token values.
- The extension must receive only `BRIDGE_BROWSER_TOKEN`.
- Missing, weak, or identical control/browser tokens are blocking failures.
- `OPENBROWSER_INSECURE_DEV=1` is a blocking failure.
- A stopped service and an empty project registry are actionable warnings, not installation failures.
- Background startup remains disabled unless `-EnableBackgroundService` is explicitly supplied.

## Implementation status

- [x] Create implementation plan.
- [x] Define diagnostics contract tests before implementation.
- [x] Add read-only installation diagnostics engine.
- [x] Define CLI formatting and exit-code tests.
- [x] Add `openbrowser doctor [--json]` and launcher routing.
- [x] Add doctor CLI smoke coverage.
- [x] Define Windows installer source-contract tests.
- [x] Resolve repository and companion paths from `$PSScriptRoot`.
- [x] Verify Node, Python, Corepack, pnpm, root runtime, and companion.
- [x] Preserve existing secure configuration and generate only missing credentials.
- [x] Run diagnostics after global linking.
- [x] Keep login startup opt-in and idempotent.
- [x] Add complete Chrome workstation smoke checklist.
- [x] Link the checklist from primary browser-first documentation.
- [ ] Pass the complete Linux verification job.
- [ ] Pass the complete Windows verification job.
- [ ] Review the cumulative PR for scope and security drift.
- [ ] Merge the cumulative PR into `main`.

## Release gate

This pass may merge only when:

- all doctor tests pass;
- all CLI tests pass;
- installer source-contract tests pass;
- the doctor output is confirmed secret-free;
- root and companion verification pass on Linux and Windows;
- no prompt-library or provider-runtime feature changes are included;
- the PR documents that authenticated Chrome interaction remains a manual workstation smoke test.

## Manual post-merge validation

Run `docs/browser-first-smoke-checklist.md` on the target Windows workstation before publishing a packaged release. Record failures using doctor JSON, service logs, run ID, audit history, extension version, provider URL, and Chrome console evidence without including credentials.
