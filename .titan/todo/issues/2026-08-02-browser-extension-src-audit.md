# Titan Builder — `browser-extension/` and root `src/` audit

## Audit metadata

- Repository: `Masterleeaus/Titan-Builder`
- Working branch: `agent/browser-extension-src-audit`
- Base branch: `main`
- Audit date: 2026-08-02 (Australia/Sydney)
- Scope: `browser-extension/` and repository-root `src/`
- Method: source inspection through the GitHub connector
- Runtime verification status: not run in this environment because the local runtime could not resolve `github.com` and GitHub CLI was unavailable

## Executive assessment

The repository has a coherent browser-to-local-agent architecture and contains substantial safety work: provider identity checks, separate control/browser credentials, operation approval capabilities, canonical project-path enforcement, transactional file operations, attachment correlation, and explicit tool-risk classification.

The current `main` branch still has several production-relevant defects. The highest-priority cluster is session durability and retention: session prompts and responses are held in an unbounded process-local map, so memory can grow indefinitely and pending/completed jobs disappear on restart. Parser ambiguity, non-concurrency-safe JSON stores, edit targeting, child-process cleanup, and active-project semantics should follow.

An older repair branch, `agent/fix-titan-builder-v2.6-deep-scan`, contains useful prior work but has diverged substantially from current `main` (59 commits ahead and 119 behind at audit time). It should be mined selectively, not merged wholesale.

## Architecture map

```text
AI provider page
  -> browser-extension/src/content-script.js
  -> browser-extension/src/background.js
  -> authenticated loopback bridge
  -> src/server/index.ts
  -> workflow/session coordination
  -> parser + operation planning
  -> approval-bound execution
  -> project memory/context/history
```

### Browser extension responsibilities

- Provider discovery and fail-closed page identity checks
- Prompt injection and response capture
- Attachment upload correlation
- Job claim/heartbeat/response lifecycle
- Service-worker routing, retry, and recovery polling
- Side-panel/popup prompt, skill, profile, and workspace controls

### Root `src/` responsibilities

- CLI and server entry points
- Bridge authentication and route scopes
- Session dispatch and SSE delivery
- Context budgeting and project intelligence
- Markdown/operation parsing
- Path-safe transactional file operations
- Tool registry and execution policy
- Project registry, memory, history, and verification workflows

## Confirmed current findings

### TB-AUD-001 — unbounded, non-durable session storage

**Severity:** High

**Evidence:** `src/server/session-store.ts`

The module stores every prompt, system prompt, composer message, partial response, final response, error, and claim record in a process-global `Map<string, PromptSession>`. There is no entry limit, byte limit, TTL, completed-session pruning, or disk persistence.

**Impact:**

- Long-running bridges can accumulate unbounded sensitive text and memory usage.
- Completed and failed sessions remain resident until process exit.
- Pending and claimed jobs are lost when the bridge restarts.
- Browser-side recovery cannot recover records that no longer exist server-side.

**Recommended repair:** Introduce a durable session store with bounded prompt/response sizes, status-aware retention, TTL pruning, startup recovery, and explicit deletion. Keep an in-memory index only as a cache.

---

### TB-AUD-002 — unlabeled Markdown/YAML can be assigned to the wrong file

**Severity:** High

**Evidence:** `src/parser/markdown-agent.ts`

`mergeMarkdownFencesIntoOperations()` and `mergeYamlFencesIntoOperations()` accept unlabeled fences. A single fence is copied into every pending file operation of the matching type. Multiple fences are sorted by content length and paired with pending operations by position.

**Impact:** A valid-looking model response can silently write one document into multiple targets or pair content with the wrong target.

**Recommended repair:** Require exact path labels whenever more than one writable operation exists. Reject ambiguous cardinality instead of guessing. Keep unlabeled fallback only for exactly one pending target and one matching fence.

---

### TB-AUD-003 — JSON block balancing ignores strings and escapes

**Severity:** Medium

**Evidence:** `src/parser/markdown-agent.ts`, `extractBalancedJson()`

The brace scanner increments and decrements depth for every `{` and `}` character, including braces inside JSON strings. It does not track quoted-string or escape state.

**Impact:** Operation JSON containing braces in content strings can be truncated or extended incorrectly, causing parse failure or incorrect removal from the surrounding response.

**Recommended repair:** Implement a string-aware scanner that tracks quote state and escaped backslashes, or use a streaming JSON parser for candidate extraction.

---

### TB-AUD-004 — partial edits can silently target the wrong region

**Severity:** Medium

**Evidence:** `src/operations/index.ts`, `nextContent()` and `applyLineEdit()`

Search/replace checks only that the search text exists and then replaces the first occurrence. It does not reject multiple matches. Line edits clamp `endLine` to the current file length rather than rejecting a stale or oversized approved range.

**Impact:** Repeated text or changed line counts can result in a different edit from the one the user believed they approved.

**Recommended repair:** Require exactly one search match unless an explicit occurrence index or expected hash is supplied. Reject `endLine` beyond the approved snapshot. Bind partial edits to surrounding context or a content hash.

---

### TB-AUD-005 — operation planning reads complete files before applying limits

**Severity:** Medium

**Evidence:** `src/operations/index.ts`, `readPathSnapshot()`

Planning and precondition generation read each file fully as UTF-8 to hash state and build diffs. Large or non-text files can therefore consume substantial memory before any context budget or output limit applies.

**Impact:** A large file can cause high memory use, slow planning, invalid UTF-8 interpretation, or process instability.

**Recommended repair:** Reject unsupported/binary targets early; enforce a configurable operation-file size limit; use streaming hashes; only load full text after type and size validation.

---

### TB-AUD-006 — timeout/output enforcement may leave descendant processes alive

**Severity:** Medium

**Evidence:** `src/operations/index.ts`, `runTool()`

On timeout or output overflow, execution calls `child.kill()` only. Package scripts can spawn descendants that outlive the immediate child, especially on Windows.

**Impact:** Timed-out builds, test runners, or scripts can continue modifying files, holding ports, or consuming resources after the bridge reports failure.

**Recommended repair:** Launch tools in an isolated process group/job object and terminate the full tree. Add a grace period followed by forced termination and verify exit before settling.

---

### TB-AUD-007 — project memory and history writes can lose concurrent updates

**Severity:** Medium

**Evidence:** `src/memory/project-memory.ts` and `src/memory/index.ts`

Both stores use read-modify-write JSON flows without a mutex, file lock, revision check, or transactional database. `project-memory.ts` uses a temp path based only on PID, so overlapping writes within one process can collide.

**Impact:** Concurrent requests can overwrite each other, lose history entries, fail during temp-file rename, or return success for data that was subsequently replaced.

**Recommended repair:** Serialize writes per project and use unique temporary names plus revision checks, or move memory/history to SQLite with transactions.

---

### TB-AUD-008 — active-project selection does not redirect operational roots

**Severity:** Low/Medium

**Evidence:** `src/index.ts` and `src/server/index.ts`

The CLI registry can select an active project, but memory, context, and operation commands continue using `process.cwd()`. The server similarly captures one canonical `projectRoot` at startup while `/projects/active` changes registry metadata only.

**Impact:** Users can reasonably believe they switched the target project while commands still operate against the launch directory.

**Recommended repair:** Choose one explicit contract:

1. Active project controls every project-scoped command and server route; or
2. Active project is navigation metadata only, renamed and surfaced as such.

Fail when the selected project and operational root disagree unless the user explicitly overrides the target.

## Prior findings that appear repaired in current code

These conclusions are source-based and still require runtime regression testing.

- **Provider routing:** Grok is limited to `grok.com`, supported paths, and page-root identity selectors. Broad `x.com` composer risk is no longer present in the inspected manifest/provider definitions.
- **Tool risk:** npm/pnpm tests and scripts are classified as `ARBITRARY_EXECUTION`; installs use `--ignore-scripts` and are classified as `NETWORK_WRITE`.
- **Operation integrity:** planning preserves operation order, hashes approved preconditions, journals transactions, takes backups, and attempts rollback.
- **Attachment correlation:** current content-script flow uses expected filename/size evidence and before/after preview state.
- **Bridge boundary:** current server code separates browser and control authority, applies origin checks, and uses one-time operation approvals.

## Structural risks and maintainability observations

1. `browser-extension/src/content-script.js` is a large multi-provider runtime and remains a major regression concentration point.
2. `browser-extension/src/background.js` mixes transport, recovery, tab selection, export, prompt-library delivery, and workspace enrichment.
3. Root `src/index.ts`, `src/server/index.ts`, `src/operations/index.ts`, and `src/parser/markdown-agent.ts` are broad orchestration modules with high change blast radius.
4. Browser selectors are inherently volatile. Provider-specific fixture tests and rendered smoke tests should be release gates rather than optional checks.
5. The repository contains two related local-server concepts: the root bridge and the `browser-extension/` workspace companion. Their authority and port boundaries are documented but still easy for contributors to confuse.

## Recommended repair order

1. **Session persistence, limits, pruning, and restart recovery** (`TB-AUD-001`).
2. **Reject ambiguous file-content association** and fix JSON balancing (`TB-AUD-002`, `TB-AUD-003`).
3. **Make partial edits uniquely targeted and approval-bound** (`TB-AUD-004`).
4. **Bound operation file reads and binary handling** (`TB-AUD-005`).
5. **Terminate full process trees** (`TB-AUD-006`).
6. **Serialize or transactionally store memory/history** (`TB-AUD-007`).
7. **Resolve active-project semantics** (`TB-AUD-008`).
8. Split large extension and server modules only after behavior is protected by regression tests.

## Validation gates for subsequent repairs

- Root TypeScript typecheck and production build
- Root Node and integration test suites
- Manifest V3 extension integrity check
- Browser-extension unit/integration tests
- Provider fixture tests for positive and negative page identity
- Restart-recovery integration test
- High-volume retention/pruning test
- Concurrent memory/history write test
- Duplicate search-match and stale line-range tests
- Descendant-process termination tests on Linux and Windows
- Rendered extension QA in at least Chromium desktop and one narrow side-panel viewport

## Immediate implementation target

Begin with `TB-AUD-001`. It combines privacy, reliability, and resource-exhaustion risk and is foundational for browser-job recovery. The repair should introduce a store abstraction first, preserve existing route contracts, and add failure-first tests for retention, size bounds, pruning, and restart recovery before replacing the in-memory implementation.
