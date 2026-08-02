# Browser Install Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the browser-first OpenBrowser workflow installable and diagnosable on a real Windows workstation with one hardened installer, one deterministic `openbrowser doctor` command, and one repeatable Chrome smoke checklist.

**Architecture:** Add a UI-neutral diagnostics engine under `src/diagnostics/` that inspects the installed runtime without changing files. Expose it through the existing launcher as `openbrowser doctor`, harden `scripts/install-windows.ps1` to install and verify both the root runtime and the `browser-extension/` companion from any working directory, and document the remaining authenticated-Chrome steps as an explicit manual smoke procedure. Keep the extension thin and keep all filesystem and service authority in the local Node runtime.

**Tech Stack:** TypeScript, Node.js 22, Commander, PowerShell 5.1+, pnpm 11.2.2, existing service manager and project registry, Node test runner, GitHub Actions Linux/Windows matrix.

## Global Constraints

- Work only on `feature/browser-install-readiness` created from current `main`.
- Do not add provider-specific automation or duplicate browser workflow execution logic.
- `openbrowser doctor` must be read-only and must never print token values.
- Diagnostics must distinguish blocking failures from actionable warnings.
- Warnings must not cause a non-zero exit code; failures must.
- The Windows installer must resolve the repository root from `$PSScriptRoot`, not the caller's current directory.
- The installer must install and verify both the root package and `browser-extension/` companion.
- Background startup remains opt-in through `-EnableBackgroundService`.
- The extension continues to receive only `BRIDGE_BROWSER_TOKEN`; `BRIDGE_TOKEN` must never be copied into Chrome.
- Every production change requires a failing regression test first.
- Final integration requires the full Linux and Windows verification matrix to pass.

---

### Task 1: Read-only installation diagnostics engine

**Files:**
- Create: `src/diagnostics/install-doctor.ts`
- Create: `src/diagnostics/install-doctor.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `runInstallDoctor(options?): Promise<InstallDoctorReport>`
- Produces: `InstallDoctorCheck`, `InstallDoctorReport`, and `InstallDoctorOptions`
- Consumes: `parseEnvironmentText`, `createServiceManager`, `listProjects`, package-root paths, and injected filesystem/process dependencies.

- [ ] Write failing tests proving the report includes checks for Node 22+, user configuration, distinct control/browser tokens, secure flags, extension manifest presence, companion package presence, project registration, and bridge service health.
- [ ] Write a failing test proving token values never appear in serialized report output.
- [ ] Write a failing test proving missing projects and a stopped service are warnings, while missing/short/equal tokens are failures.
- [ ] Write a failing test proving `report.ok` is false only when at least one check has status `fail`.
- [ ] Add `src/diagnostics/install-doctor.test.ts` to `test:node` and verify the suite fails because the module does not exist.
- [ ] Implement the minimal read-only diagnostics engine with stable check IDs and deterministic ordering.
- [ ] Re-run focused and full root verification.

Required check IDs and rules:

| ID | Result rule |
|---|---|
| `runtime.node` | pass for Node major >= 22; fail otherwise |
| `config.file` | pass when the resolved config exists and parses; fail when absent or unreadable |
| `config.control-token` | pass for length >= 32; fail otherwise |
| `config.browser-token` | pass for length >= 32; fail otherwise |
| `config.token-separation` | pass when both tokens are present and different; fail otherwise |
| `config.secure-mode` | fail when `OPENBROWSER_INSECURE_DEV=1`; warn when unsafe commands are enabled; pass otherwise |
| `extension.manifest` | pass when `browser-extension/manifest.json` exists and is valid JSON; fail otherwise |
| `companion.package` | pass when `browser-extension/package.json` exists; fail otherwise |
| `projects.registry` | pass when one or more projects exist; warn when empty |
| `service.bridge` | pass when running and healthy; warn when stopped; fail when running but unhealthy |

### Task 2: `openbrowser doctor` CLI adapter

**Files:**
- Create: `src/diagnostics/doctor-cli.ts`
- Create: `src/diagnostics/doctor-cli.test.ts`
- Modify: `src/launcher.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runInstallDoctor()`
- Produces: `registerDoctorCommand(program: Command): void`
- CLI: `openbrowser doctor [--json]`

- [ ] Write a failing test proving human output contains PASS/WARN/FAIL summaries without secrets.
- [ ] Write a failing test proving `--json` emits the exact structured report and no decorative output.
- [ ] Write a failing test proving the command sets exit code `1` for report failures and `0` for warnings-only reports.
- [ ] Implement the minimal CLI adapter.
- [ ] Route `doctor` through `src/launcher.ts` without changing existing command behavior.
- [ ] Update `smoke:cli` to include `node dist/launcher.js doctor --help`.
- [ ] Run focused tests, full tests, build, and CLI smoke checks.

### Task 3: Harden Windows installation

**Files:**
- Modify: `scripts/install-windows.ps1`
- Create: `scripts/install-windows.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Installer invocation: `powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 [-EnableBackgroundService]`
- Consumes: root and companion lockfiles, Python 3, Corepack, pnpm, built CLI, and `openbrowser doctor`.

- [ ] Write failing source-contract tests proving the installer derives `$RepositoryRoot` from `$PSScriptRoot`, uses `Push-Location`/`Pop-Location`, verifies Python, installs the companion lockfile, runs companion verification, and invokes `openbrowser doctor` after global linking.
- [ ] Add the installer regression test to `test:node` and verify it fails against the current script.
- [ ] Refactor the installer so all root commands run from `$RepositoryRoot` and all companion commands run from `$RepositoryRoot\browser-extension`.
- [ ] Require `python` before companion verification and print a direct remediation message when unavailable.
- [ ] Preserve existing `.openbrowser/.env` values while generating only missing secure tokens.
- [ ] Keep background Scheduled Task registration opt-in and idempotent.
- [ ] Invoke `openbrowser doctor` after linking; do not fail installation for warnings-only output.
- [ ] Print the canonical unpacked-extension path derived from `$RepositoryRoot`.
- [ ] Run installer source tests and the full matrix.

### Task 4: Repeatable browser smoke procedure

**Files:**
- Create: `docs/browser-first-smoke-checklist.md`
- Modify: `docs/browser-first-local-agent.md`
- Create: `.titan/todo/issues/browser-install-readiness.md`

**Interfaces:**
- Consumes: `openbrowser doctor`, service commands, project registration, Chrome extension settings, and Work view.
- Produces: an operator checklist with explicit expected results and failure evidence.

- [ ] Document preflight commands: `openbrowser doctor`, `openbrowser service status`, and `openbrowser project list`.
- [ ] Document extension loading, restricted token configuration, supported-provider tab setup, and Work tab discovery.
- [ ] Define one Ask smoke case that must not modify files.
- [ ] Define one Agent smoke case using a disposable registered fixture project, preview review, two-stage approval, apply, and verification.
- [ ] Define stale-preview, service-restart, cancellation, and token-separation checks.
- [ ] Define exact evidence to capture for failures: doctor JSON, service logs, run ID, audit endpoint response, extension version, provider URL, and Chrome console error.
- [ ] Link the checklist from the primary browser-first documentation.
- [ ] Record scope, release gate, and completed checks in the Titan issue file.

### Task 5: Final verification and integration

**Files:**
- Review: all changed files
- Modify only when verification exposes a confirmed defect.

**Interfaces:**
- Produces: one cumulative pull request merged into `main`.

- [ ] Run the full repository verification matrix on Linux and Windows.
- [ ] Confirm the root and companion package verification commands pass.
- [ ] Confirm `openbrowser doctor --json` never contains token values.
- [ ] Confirm installer source tests cover repository-root resolution and companion verification.
- [ ] Review the PR diff for accidental prompt-library, provider, or agent-runtime changes.
- [ ] Update the PR with exact verification evidence and the limitation that authenticated Chrome interaction remains a manual workstation smoke test.
- [ ] Merge once using the verified head SHA.

## Completion Evidence

This pass is complete only when:

- `openbrowser doctor` exists and is read-only;
- diagnostics classify blocking failures and warnings deterministically;
- secrets are absent from both human and JSON output;
- the Windows installer works independently of the caller's working directory;
- root and companion dependencies and verification are both included;
- the smoke checklist covers Ask, Agent, approval, stale preview, restart, and evidence capture;
- all Linux and Windows CI jobs pass;
- the cumulative PR is merged into `main`.
