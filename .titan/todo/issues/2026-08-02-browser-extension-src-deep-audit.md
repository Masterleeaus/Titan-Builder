# Titan Builder Browser Extension and `src/` Deep Audit — Pass 2

- Date: 2026-08-02
- Repository: `Masterleeaus/Titan-Builder`
- Source baseline inspected: `main` at `09ce008b0fd024fcfd92262a221a02ab9fa30045`
- Audit branch: `agent/browser-extension-src-audit`
- Scope: `browser-extension/`, root `src/`, their tests, package scripts, and direct runtime documentation
- Method: static execution-path tracing through CLI, bridge server, browser-run coordinator, extension service worker, content script, side panel, operation engine, verification, service lifecycle, and the standalone workspace companion

This is a second-pass audit. It excludes the eight findings already tracked as GitHub issues `#19`–`#26` unless a separate implementation exposes a distinct defect.

## Executive summary

The deeper trace found **30 additional items**:

- 13 confirmed defects or security/policy violations
- 10 architectural drift or incomplete wiring findings
- 7 resilience, performance, and product upgrades

The highest-priority problems are:

1. legacy context APIs can escape the project boundary through sibling-prefix and symlink paths;
2. browser-run transitions are not serialized and can overwrite each other;
3. cancelling a run does not cancel the underlying browser session or model generation;
4. per-run provider choice is stored but ignored during dispatch;
5. Ask capture can discard prose and all but one Markdown block;
6. response timeout can return incomplete output as success;
7. generic YAML reconstruction can silently corrupt non-Docker YAML;
8. post-apply verification executes repository scripts outside the reviewed operation approval;
9. failed verification is recorded under a terminal `completed` run;
10. the companion review routes return only a queued-session receipt, not the requested review result.

---

# Confirmed defects and security findings

## TB-DEEP-001 — Legacy context loaders permit project-boundary escape

**Severity:** Critical latent security defect  
**Classification:** Confirmed unsafe exported code; current primary context builder uses a safer implementation

### Evidence

- `src/context/file-context.ts` validates containment with a raw string-prefix comparison.
- A sibling path such as `/work/repo-secrets` starts with `/work/repo` but is not inside it.
- The helper follows filesystem links before reading content.
- `src/context/directory-tree.ts` contains the same prefix-style boundary logic.
- These helpers remain exported from the context subsystem even though the newer budgeted context path uses `src/security/project-path.ts`-style containment.

### Impact

A future or legacy call site can attach a sibling or symlink-resolved file outside the registered repository and send it to the browser AI provider. Keeping an unsafe exported alternative beside the safe resolver makes regression likely.

### Required change

- Delete the legacy loaders if unused, or route every filesystem lookup through `canonicalizeProjectRoot()` and `resolveProjectPath()`.
- Reject symlink/junction segments.
- Add sibling-prefix, symlink, junction, encoded separator, and Windows-drive tests.
- Add a repository check preventing new raw `startsWith(projectRoot)` containment logic.

---

## TB-DEEP-002 — Browser-run state transitions are race-prone

**Severity:** High  
**Classification:** Confirmed concurrency defect

### Evidence

- `src/workflows/browser-run-store.ts` performs read-check-write transitions without a per-run mutex, revision compare-and-swap, or serialized queue.
- `transition()`, `setPreview()`, persistence, and event append can overlap.
- Coordinator endpoints permit concurrent approve, apply, reject, cancel, and background preparation activity.
- Two apply requests can both observe `ready_to_apply`; the losing request can enter its error path while the winning request is already applying or verifying.

### Impact

A stale request can overwrite a newer status, create an invalid event order, mark a successful run failed, or leave the persisted record inconsistent with filesystem changes.

### Required change

- Add per-run serialized mutation or revisioned compare-and-swap.
- Include a monotonic record revision in every mutation and API response.
- Make approval-token consumption and `ready_to_apply -> applying` one atomic transition.
- Add deterministic concurrent approve/apply/cancel/reject tests.

---

## TB-DEEP-003 — Cancelling a run does not stop browser work

**Severity:** High  
**Classification:** Confirmed lifecycle defect

### Evidence

- `BrowserRunCoordinator.cancel()` deletes prepared in-memory state and marks the run cancelled.
- `queueBrowserWorkflowPromptAndWait()` continues polling the prompt session for up to fifteen minutes.
- No abort signal is passed through agent preparation, session queueing, extension dispatch, claim heartbeat, provider wait, or auto-continue.
- There is no browser-session cancellation endpoint or cancellation event consumed by the content script.

### Impact

A cancelled run can continue generating, auto-continuing, using browser resources, and eventually posting a response that no longer has a valid workflow consumer.

### Required change

- Introduce an abortable run context and propagate it through every layer.
- Add a server-side session status of `cancelled` and a browser cancellation event.
- Make the content script stop heartbeat, stop auto-continue, and stop waiting when cancellation is observed.
- Test cancellation during context build, provider generation, retry, approval wait, and response upload.

---

## TB-DEEP-004 — Per-run provider selection is ignored

**Severity:** High product correctness defect  
**Classification:** Confirmed unwired feature

### Evidence

- `/workspace/runs` accepts `provider` and the browser-run record persists it.
- The coordinator does not include that provider in the `AgentSubmissionRequest` sent to the prompt-session bridge.
- `toBrowserJob()` does not include a provider.
- `browser-extension/src/background.js` dispatches workflow jobs using only global `preferredProvider`.

### Impact

A run requested for Claude, Gemini, or another provider can be sent to a different globally preferred provider while the run record still reports the requested provider.

### Required change

- Propagate provider from run creation to session and browser job.
- Make dispatch fail explicitly when the requested provider has no valid ready tab.
- Record requested and actual provider separately.
- Add end-to-end tests with conflicting run-level and global preferences.

---

## TB-DEEP-005 — Ask capture can discard valid response content

**Severity:** High  
**Classification:** Confirmed response-capture defect

### Evidence

- `buildAskCaptureText()` collects Markdown-looking `<pre>` blocks.
- When any are present, it returns only the longest block wrapped as Markdown.
- Surrounding explanation and additional Markdown blocks are discarded.

### Impact

A correct model answer containing prose plus a Markdown example, or multiple Markdown examples, is returned to the CLI incomplete without any warning.

### Required change

- Serialize the complete assistant message in DOM order.
- Preserve prose, lists, tables, and every code/pre block.
- Use Markdown-block-only extraction exclusively for the explicit Markdown-draft workflow.
- Add fixtures for prose plus code, multiple blocks, nested lists, tables, and provider-specific DOM structures.

---

## TB-DEEP-006 — Model timeout can be reported as successful completion

**Severity:** High  
**Classification:** Confirmed lifecycle/status defect

### Evidence

- The content-script wait loop tracks the last captured text.
- At the overall timeout it can return `lastText` even when the provider still appears to be generating or the response never reached the stable completion condition.
- The returned text is then posted as a normal completed browser response.

### Impact

Ask responses may be silently truncated. Agent responses may be parsed from incomplete JSON or file blocks and treated as a normal model answer instead of a timeout.

### Required change

- Return a typed timeout/incomplete error unless completion was positively observed.
- Persist partial text separately for recovery and diagnostics.
- Never convert a generation timeout into `complete` solely because some text exists.
- Add timeout tests while the stop button remains present and while output changes slowly.

---

## TB-DEEP-007 — YAML capture repair can corrupt arbitrary YAML

**Severity:** High  
**Classification:** Confirmed unsafe transformation

### Evidence

- `normalizeYamlCaptureText()` attempts to reconstruct flattened YAML using `version`, `services`, and service-level indentation assumptions.
- The function is applied to every `.yml` and `.yaml` file block.
- GitHub Actions, Kubernetes, CI, Ansible, pnpm workspace, and application YAML use different nesting models.

### Impact

Valid model output can be silently rewritten into structurally different YAML before preview, making the displayed operation differ from the intended file.

### Required change

- Remove semantic YAML reconstruction from capture.
- Preserve exact DOM/code text and normalize only line endings.
- If provider DOM destroys whitespace, fail capture and retry with an explicit plain-text/file-block instruction.
- Validate YAML syntax without inventing indentation.

---

## TB-DEEP-008 — Post-apply verification bypasses operation-level approval

**Severity:** High security and policy violation  
**Classification:** Confirmed approval-model drift

### Evidence

- `npm.run` and `pnpm.run` are classified as `ARBITRARY_EXECUTION` and require explicit approval.
- Browser-run approval covers selected model operations and their server-side preview.
- `applyApprovedAgentRun()` invokes verification after applying files; verification commands are not part of the selected operation IDs or approval capability.
- A verification profile can therefore execute repository-controlled scripts without a command-level reviewed approval.

### Impact

Code from the repository can execute after a file-only approval even though the tool registry says that execution requires explicit approval.

### Required change

- Detect verification commands before apply and include them in the review model, or require a second one-time approval capability.
- Show exact executable, arguments, cwd, risk, and locked package inputs.
- Never infer approval for arbitrary package scripts solely from selecting a profile name.

---

## TB-DEEP-009 — Failed verification still produces a completed run

**Severity:** High  
**Classification:** Confirmed false-success status

### Evidence

- Verification returns `passed` or `failed`.
- The coordinator stores a failed verification result and then transitions the run to terminal `completed` regardless.
- The README states that execution and verification failures stop the pass.

### Impact

Clients, dashboards, automation, and audit consumers can treat a failed build or test suite as a successful completed run.

### Required change

- Transition failed verification to `failed`, or add a distinct terminal status such as `completed_with_failed_verification` that cannot be mistaken for success.
- Return non-success HTTP semantics where appropriate.
- Add failing verification end-to-end tests.

---

## TB-DEEP-010 — Large-prompt file delivery is redundant, unwired, and retains sensitive files

**Severity:** High/Medium  
**Classification:** Confirmed dead pipeline and data-retention defect

### Evidence

- The root server writes `.openbrowser/prompts/<session>.txt` and exposes `/browser/prompt-file/:sessionId`.
- Browser jobs still contain the full `promptBody`.
- The extension builds attachment content from the job payload and does not consume the prompt-file endpoint.
- Prompt files are not deleted on completion, failure, cancellation, claim expiry, or retention pruning.

### Impact

The feature does not reduce SSE/job payload size, duplicates sensitive prompts on disk, and leaves stale files indefinitely.

### Required change

Choose one authoritative design:

- **Server-file design:** send only metadata in the job, fetch authenticated content once, and delete it after terminal handling; or
- **Payload design:** remove disk files and the dead endpoint.

Add prompt-file retention, restart, cancellation, and cleanup tests.

---

## TB-DEEP-011 — Standalone companion review routes return a receipt, not a review

**Severity:** High functional defect  
**Classification:** Confirmed incomplete wiring

### Evidence

- `browser-extension/bridge-server.ts` implements `/prompt`, `/code/review`, and `/pr/analyze` by calling root `/session/prompt`.
- Root `/session/prompt` returns a queued session receipt containing `sessionId` and status.
- The companion immediately marks its local job complete and returns that receipt.
- It never waits on root session events/status for final model output.

### Impact

Endpoints named review/analyze do not provide the requested review or analysis. Callers can record a queued receipt as a completed analysis result.

### Required change

- Follow root session SSE/status until completion, error, cancellation, or timeout.
- Stream progress or return `202` with a companion job that remains running.
- Persist final model output separately from queue metadata.
- Add true end-to-end tests through both servers and the extension.

---

## TB-DEEP-012 — Fresh-project install instructions cannot succeed

**Severity:** High workflow defect  
**Classification:** Confirmed prompt/tool contract contradiction

### Evidence

- Agent system examples scaffold new package manifests and then request `pnpm.install` or `npm.install`.
- `pnpm.install` uses frozen-lockfile mode and requires `pnpm-lock.yaml`.
- `npm.install` resolves to `npm ci --ignore-scripts` and requires `package-lock.json`.
- New scaffolds do not yet have those lockfiles.

### Impact

The model is instructed to produce a plan that the operation engine rejects or that the package manager cannot execute.

### Required change

- Add a separately named, explicitly approved bootstrap install tool with defined network and lifecycle-script policy; or
- stop instructing models to install dependencies for lockfile-free scaffolds.
- Generate lockfiles through a reviewed bootstrap step before frozen installs.

---

## TB-DEEP-013 — Provider identity checks are incomplete outside Grok

**Severity:** High browser safety risk  
**Classification:** Confirmed provider-adapter drift

### Evidence

- Grok has explicit path restrictions and root selectors.
- Other providers accept broad host matches and generic textarea/contenteditable/button selectors across the host.
- No equivalent path or page-root identity gate is enforced before insert/submit for those providers.

### Impact

On a supported host but non-chat page, the extension can target an unrelated editor, search field, settings form, or button.

### Required change

- Add provider-specific safe paths, root identity, composer ownership, send-button ownership, and visible/enabled checks.
- Fail closed when page identity is uncertain.
- Add negative fixtures for settings, account, search, library, and marketing pages on every supported host.

---

## TB-DEEP-014 — `.openbrowser` internal metadata is writable by model operations

**Severity:** High/Medium integrity risk  
**Classification:** Confirmed missing reserved-path boundary

### Evidence

- File operations deny project escape and symlinks but do not reserve `.openbrowser/`.
- Model-authored operations can target history, settings, prompts, and transaction metadata inside the project.

### Impact

An AI response can overwrite or delete audit history and internal state, weakening forensic and recovery guarantees.

### Required change

- Reserve `.openbrowser/` from model-authored file operations.
- Permit writes only through internal typed APIs.
- Add negative tests for every operation action and rename destination.

---

# Architectural drift and incomplete wiring

## TB-DEEP-015 — Browser-run persistence retains unbounded sensitive artifacts

**Severity:** High/Medium  
**Classification:** Persistence and privacy drift

The browser-run store persists prompts, responses, full operation diffs, raw model responses, prepared artifacts, and append-only event files. There are no per-field, per-record, event-file, or total-byte limits. Event arrays are also cached in memory. Pruning applies only to terminal runs and is triggered during creation rather than by startup/periodic maintenance.

**Upgrade:** enforce byte/count/age limits, chmod/ACL protections, periodic pruning, bounded event tails, and separate redacted audit metadata from full transient payloads.

---

## TB-DEEP-016 — Corrupt browser-run files are silently ignored

**Severity:** Medium  
**Classification:** Recovery and observability defect

Malformed run records, prepared artifacts, and individual JSONL event records can be skipped without quarantine or an operator-visible error. This can silently remove audit history or make a recoverable run appear missing.

**Upgrade:** quarantine corrupt files, emit a structured recovery finding, preserve raw bytes, and expose repair/export commands.

---

## TB-DEEP-017 — Workspace event streaming exists but the UI polls instead

**Severity:** Medium  
**Classification:** Unwired code

The root server exposes `/workspace/runs/:runId/events`, and `browser-run-events.js` implements an SSE client. The agent workspace uses periodic polling instead. Transient polling errors can stop monitoring, the active-run storage key can retain terminal runs, and the dedicated stream helper is dead code.

**Upgrade:** wire the SSE helper with reconnect/resume semantics, retain polling only as fallback, and clear active-run state at terminal completion.

---

## TB-DEEP-018 — Active run provider/session heartbeat failures do not abort local capture

**Severity:** Medium  
**Classification:** Lifecycle resilience gap

Heartbeat renewal failures are logged, but the content script can continue waiting and generating. If the claim has expired, the final response will be rejected and the work is wasted.

**Upgrade:** abort after a bounded number of renewal failures, stop auto-continue, release local state, and let another claimant recover the session.

---

## TB-DEEP-019 — Root request-size policy conflicts with advertised large prompts

**Severity:** Medium/High  
**Classification:** Cross-layer limit drift

The root Fastify server does not configure an explicit body limit, while context/prompt contracts and the companion permit multi-megabyte payloads. Large requests or browser responses can hit an undocumented framework ceiling before prompt-file conversion or response handling runs.

**Upgrade:** define one documented aggregate request/response policy, configure Fastify explicitly, and prefer streaming/file references for large content.

---

## TB-DEEP-020 — The standalone workspace companion duplicates project authority

**Severity:** Medium architectural risk  
**Classification:** Deliberate but drift-prone parallel subsystem

`browser-extension/bridge-server.ts` runs a second Fastify server on port 5010 with SQLite projects, jobs, indexing, analysis, WebSockets, auth, and package lifecycle. Root `src/server` remains authoritative on port 5000 with a JSON registry and different active-project semantics. The companion README requires users to register the same project in both processes.

**Upgrade:** either integrate these capabilities behind root server interfaces or move the companion into a clearly separate optional package with explicit project-ID mapping and health checks. Avoid two independently selected “active projects.”

---

## TB-DEEP-021 — Canonical profile library is authored but not runtime-integrated

**Severity:** Medium product incompleteness  
**Classification:** Explicitly documented pending integration

The repository contains 35 Markdown profile assets, but the extension exposes four hardcoded JavaScript profiles. The progress ledger explicitly states runtime loading, schema/index creation, aliases, UI integration, and migration remain pending.

**Upgrade:** generate a versioned profile catalog, preserve aliases, validate packaged profiles, expose domain filtering/detail, and test prompt composition across side-panel and recovered CLI jobs.

---

## TB-DEEP-022 — Custom skill IDs can shadow canonical built-ins

**Severity:** Medium integrity defect  
**Classification:** Namespace collision

`allSkills()` places custom skills after built-ins, and `resolveWorkspaceContext()` constructs a map by ID. A custom skill with a canonical ID can replace the built-in instruction object used in prompt composition. Custom profile ID collisions also create ambiguous duplicate UI records.

**Upgrade:** reserve canonical IDs and aliases, migrate conflicting local records to generated custom IDs, and display validation errors instead of silently resolving collisions.

---

## TB-DEEP-023 — Agent prompt has Markdown and version drift

**Severity:** Medium  
**Classification:** Prompt protocol drift

- The agent prompt says a Markdown file should be enclosed in one triple-backtick Markdown fence while nested triple-backtick Bash fences are allowed. Equal-length fences do not nest reliably.
- It hardcodes `pnpm@10.12.4`, while the repository pins pnpm `11.2.2`.

**Upgrade:** use four-backtick outer fences or the same path-labelled file-block protocol for Markdown, and derive package-manager guidance from runtime metadata rather than hardcoded versions.

---

## TB-DEEP-024 — Retry system-instruction suppression is defeated by extension recomposition

**Severity:** Medium  
**Classification:** Cross-layer prompt drift

Agent preparation can suppress repeated system instructions on retries, but the extension reconstructs the outbound prompt and prepends the supplied system prompt again. Retries remain large and may not follow the intended minimal correction flow.

**Upgrade:** transmit an explicit composition mode or a fully composed immutable message; do not independently reconstruct protocol instructions in both server and extension.

---

# Performance, resilience, and product upgrades

## TB-DEEP-025 — Companion indexing uses unbounded concurrent full-file reads

**Severity:** Medium/High performance risk

`indexProjectFiles()` starts asynchronous hashing for every discovered file and waits on the entire pending array. Each eligible file can be read fully into memory, up to 50 MB. Large repositories can create excessive open files, memory pressure, and event-loop contention.

**Upgrade:** bounded worker pool, streaming hashes, global file/byte ceilings, cancellation, and progress/backpressure.

---

## TB-DEEP-026 — Detached service trusts PID existence rather than process identity

**Severity:** High local safety risk

The service manager determines liveness with the stored PID. PID reuse can make status report an unrelated process and can cause stop to signal it. Startup can also treat any live reused PID as an already-running service.

**Upgrade:** verify executable path, start time, nonce/control handshake, and health identity before reporting or terminating. Never kill based only on PID existence.

---

## TB-DEEP-027 — Detached service log limits are ineffective during runtime

**Severity:** Medium

Log rotation runs before service start, but a long-running service can grow the log beyond the configured limit indefinitely. The log-reading command reads the full file before selecting tail lines.

**Upgrade:** runtime rotation or a rotating stream, bounded tail reads, retention count, and tests with sustained output.

---

## TB-DEEP-028 — `@` context parsing corrupts ordinary prompts

**Severity:** High usability/correctness defect

The context-token parser treats broad `@token` text as a path and removes it from the clean prompt. Email addresses, scoped packages such as `@types/node`, social handles, decorators, and annotations can be altered.

**Upgrade:** consume only explicit references that resolve to safe project paths, support quoting/escaping, and leave unmatched tokens untouched.

---

## TB-DEEP-029 — Side-panel scans and ZIP exports have no aggregate resource budget

**Severity:** Medium/High browser stability risk

Visible assistant replies are cached with full text in `chrome.storage.local` without count or byte retention. ZIP export downloads and decodes files, keeps every entry in memory, then allocates the complete archive. There is no practical aggregate export cap or duplicate sanitized-path rejection in the extension ZIP implementation.

**Upgrade:** storage quotas with eviction, per-scan limits, streaming or chunked export, aggregate byte caps, duplicate-name resolution, and visible size estimates before export.

---

## TB-DEEP-030 — Extension-local verification omits extension runtime tests

**Severity:** Medium engineering drift

`browser-extension/package.json` documents a standalone workspace and its `verify` command, but its `test` script runs only `bridge-server.test.ts` plus Python tests. The content-script, service-worker, provider, side-panel, routing, export, and workspace tests are run only from the root package.

**Upgrade:** either make `browser-extension` a true package boundary whose verification includes all of its runtime tests, or remove the duplicate package boundary and centralize scripts/dependencies at root.

---

# Additional bounded improvements

These are not currently ranked as separate release blockers but should be included in the repair roadmap:

1. Add operation-count, per-field, and aggregate payload limits to `src/protocol/index.ts`.
2. Reject mutually conflicting edit forms rather than accepting content plus search/line edits together.
3. Bound context enumeration before collecting complete repository trees.
4. Avoid exposing absolute project roots in browser-facing APIs unless required.
5. Add timeouts to extension-to-bridge fetches and exponential reconnect backoff with jitter.
6. Remove stale ready-tab entries through `chrome.tabs.onRemoved` and cap in-memory dispatch queues.
7. Centralize SSE parsing; current parsers assume one `data:` line and simple LF framing.
8. Add SQLite job-history retention and compaction in the companion.
9. Minimize unauthenticated companion `/health` output; do not return the full active project record.
10. Avoid WebSocket bearer tokens in query strings where header/subprotocol authentication is possible.

---

# Recommended repair order

## Phase 1 — Prevent wrong data and false success

1. TB-DEEP-001 context boundary escape
2. TB-DEEP-005 Ask capture loss
3. TB-DEEP-006 timeout-as-success
4. TB-DEEP-007 YAML corruption
5. TB-DEEP-009 failed verification reported completed
6. TB-DEEP-013 provider page identity
7. TB-DEEP-014 reserved metadata paths

## Phase 2 — Restore workflow authority

1. TB-DEEP-002 serialized browser-run transitions
2. TB-DEEP-003 end-to-end cancellation
3. TB-DEEP-004 provider propagation
4. TB-DEEP-008 verification approval
5. TB-DEEP-010 prompt-file authority and cleanup
6. TB-DEEP-011 companion final-response wiring
7. TB-DEEP-019 explicit transport limits

## Phase 3 — Remove architectural drift

1. TB-DEEP-012 safe fresh-project bootstrap contract
2. TB-DEEP-020 consolidate the companion/project authority
3. TB-DEEP-021 profile runtime integration
4. TB-DEEP-022 reserve skill/profile namespaces
5. TB-DEEP-023 and TB-DEEP-024 prompt protocol consolidation

## Phase 4 — Harden operations and scale

1. TB-DEEP-015 and TB-DEEP-016 bounded/recoverable run persistence
2. TB-DEEP-025 bounded indexing
3. TB-DEEP-026 and TB-DEEP-027 safe service lifecycle/logging
4. TB-DEEP-028 context-token grammar
5. TB-DEEP-029 browser storage/export budgets
6. TB-DEEP-030 one authoritative extension verification pipeline

---

# Required regression matrix

A repair pass should add tests for:

- sibling-prefix, symlink, junction, and Windows path containment;
- concurrent approve/apply/cancel/reject requests;
- cancellation during generation and auto-continue;
- run-level provider routing versus global preference;
- full Ask-message capture with multiple code and Markdown blocks;
- timeout while streaming and incomplete agent JSON;
- GitHub Actions, Kubernetes, pnpm, and Docker YAML capture;
- verification command preview/approval and failed terminal status;
- prompt-file cleanup on every terminal path and restart;
- companion prompt/review final-response streaming;
- lockfile-free project bootstrap;
- non-chat pages on every provider host;
- protected `.openbrowser` paths;
- corrupt run/event artifact quarantine;
- email addresses, scoped packages, decorators, and escaped `@` context references;
- large repository indexing with bounded concurrency;
- PID reuse and service identity;
- browser storage quota and aggregate ZIP size;
- extension-local verification invoking all extension runtime tests.

---

# Positive controls retained

The deeper audit also confirmed important strengths that should not be regressed:

- root operation paths use canonical containment and reject symlink/junction segments;
- operation previews lock filesystem/tool inputs with hashes;
- apply uses one-time approval capabilities and rollback journals;
- control and browser credentials are separate;
- browser claims use expiring tokens and heartbeat renewal;
- Grok routing has explicit page restrictions;
- the skill package loader resolves assets canonically and rejects package-boundary escape;
- the companion uses argument-array process execution, loopback binding, token checks, SQLite transactions, and bounded HTTP/export inputs.

---

# Validation limitation

This pass is a static source and wiring audit through the connected GitHub repository. A local clone and rendered browser runtime were not available in this environment, so no package install, test suite, Chrome extension load, provider-page fixture, or process-level reproduction was executed. Findings above are classified from concrete control flow and data flow; runtime repair work must reproduce each defect with a focused failing test before implementation.