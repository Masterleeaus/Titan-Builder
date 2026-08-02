# Titan Builder Skill Library Roadmap

## Executive Summary

This roadmap is based on a repository-wide evidence scan of `Masterleeaus/Titan-Builder` at base commit `fade04114cdb8a512d74e49dac57e312e17028cb`, with primary emphasis on `browser-extension/` and `src/`.

Titan Builder is already a substantial local-first coding-agent system. It contains:

- a Node.js and TypeScript CLI and secure execution bridge under `src/`;
- a Manifest V3 multi-provider browser extension under `browser-extension/src/`;
- a second workspace companion runtime under `browser-extension/`;
- transactional file operations, approvals, context assembly, memory, verification, static analysis, browser automation, exports, Git helpers, hooks, and CI;
- twelve embedded coding prompts, one standalone production prompt, six built-in guidance skills, and four agent profiles.

The repository does **not** yet contain a production Skill Library architecture. The six objects currently called skills in `browser-extension/src/workspace-library.js` are prompt instruction fragments. They have no version, declared inputs or outputs, dependency graph, permissions, runtime handler, lifecycle, compatibility policy, installation model, or independent validation contract.

The scan identified **71 current reusable capability candidates**. It also identified **32 missing foundation and production capabilities** required to turn those candidates into a coherent library. The projected production library is therefore approximately **103 skills**.

The recommended architecture is:

- canonical standalone skill definitions: `browser-extension/skill-library/`;
- extension-side catalog, activation, composition, and UI adapters: `browser-extension/src/skills/`;
- root execution adapters that wrap existing secure services without duplicating manifests: `src/skills/`;
- companion execution adapters for indexing, search, analysis, and exports: `browser-extension/src/skills/runtime/` or a later shared package;
- one manifest and one stable skill ID per capability, regardless of how many runtimes expose it.

The first implementation priority is not authoring dozens of skill documents. It is establishing the manifest, loader, registry, validation, permission, dependency, execution, and test contracts that prevent another parallel system.

## Audit Scope and Evidence Standard

### Repository and branch

- Repository: `Masterleeaus/Titan-Builder`
- Default branch inspected: `main`
- Feature branch: `feature/skill-library-foundation`
- Base commit: `fade04114cdb8a512d74e49dac57e312e17028cb`
- Primary paths: `browser-extension/`, `src/`
- Supporting paths: `.github/`, `.titan/`, `docs/`, `scripts/`, root package and configuration files

### Evidence rule

A capability is recorded only where repository code, tests, scripts, manifests, workflows, or current architecture records demonstrate it. Planned functionality is classified as `Missing` unless a reachable implementation exists.

### Status legend

- `Existing` — implemented and reachable through a current runtime or tool.
- `Partial` — implemented, but incomplete, narrowly scoped, non-persistent, static, or missing a production contract.
- `Duplicate` — implemented in two or more overlapping systems that should share one skill definition.
- `Missing` — required for the projected library but no current implementation was found.

### Priority legend

- `P0` — foundation, security, data integrity, or required prerequisite.
- `P1` — high-value extraction or production hardening immediately after P0.
- `P2` — expansion, consolidation, and operator experience.
- `P3` — optional ecosystem or marketplace maturity.

## Repository Overview

### Root runtime: `src/`

The root runtime is the authoritative local execution and orchestration layer. It owns:

- CLI ask and agent modes;
- bridge client and Fastify server;
- browser session queueing, claim leases, streaming, and response collection;
- operation schemas, parsing, planning, approval, execution, rollback, and history;
- secure project path resolution;
- structured tool execution and risk classification;
- project registry, memory, status, context, and verification plans.

Key evidence paths include:

- `src/index.ts`
- `src/server/index.ts`
- `src/server/security.ts`
- `src/server/session-store.ts`
- `src/server/operation-approvals.ts`
- `src/protocol/index.ts`
- `src/parser/index.ts`
- `src/operations/index.ts`
- `src/tools/registry.ts`
- `src/context/`
- `src/memory/`
- `src/projects/`
- `src/verification/`

### Browser extension: `browser-extension/src/`

The extension owns user-facing prompt, skill, agent, project, memory, library, export, settings, and status surfaces. It also owns browser automation for supported AI websites.

Current supported providers are ChatGPT, Claude, Gemini, DeepSeek, Perplexity, GLM/Z.ai, and Grok. Provider-specific selectors and page checks live in `browser-extension/src/providers.js`.

Key evidence paths include:

- `browser-extension/manifest.json`
- `browser-extension/src/background.js`
- `browser-extension/src/content-script.js`
- `browser-extension/src/providers.js`
- `browser-extension/src/prompt-routing.js`
- `browser-extension/src/job-payload.js`
- `browser-extension/src/attachment-verification.js`
- `browser-extension/src/auto-continue-policy.js`
- `browser-extension/src/sidepanel.js`
- `browser-extension/src/workspace-library.js`
- `browser-extension/src/coding-prompts.js`
- `browser-extension/src/prompt-library.js`
- `browser-extension/src/file-exporter.js`
- `browser-extension/src/chatgpt-page-tools.js`

### Workspace companion: `browser-extension/`

A separate Fastify runtime runs on port `5010` while the main bridge remains authoritative on port `5000`. The companion owns SQLite-backed workspace registration, file indexing, ripgrep search, Python analysis, staged-file checks, ZIP generation, WebSocket progress, GitHub CLI helpers, PowerShell management, and a pre-commit hook.

Key evidence paths include:

- `browser-extension/bridge-server.ts`
- `browser-extension/schema.sql`
- `browser-extension/analysis_tools.py`
- `browser-extension/gh-openbrowser`
- `browser-extension/hooks/pre-commit`
- `browser-extension/openbrowser.ps1`
- `browser-extension/dashboard.ps1`
- `browser-extension/package.json`
- `browser-extension/README.md`

### Prompt library foundation

The repository now has a canonical standalone prompt authoring boundary:

- `browser-extension/prompt-library/`
- `.titan/todo/issues/Titan-Builder-Prompt-Library-Roadmap.md`
- `browser-extension/prompt-library/foundation/tb-prompt-found-001-repository-architecture-discovery.md`

The roadmap explicitly proposes `browser-extension/skill-library/` and `browser-extension/agent-library/` as future standalone authoring locations. No runtime loader currently reads these Markdown assets.

### Verification and automation

The repository has separate root and companion verification systems:

- `.github/workflows/verify.yml`
- `.github/workflows/workspace-tools.yml`
- `.github/workflows/apply-ob009.yml`
- root `package.json` verification scripts
- companion `browser-extension/package.json` verification scripts

## Existing Architecture

### AI architecture

The primary AI path is browser-powered rather than direct-provider API integration:

1. CLI or local caller creates a prompt session through the root bridge.
2. The bridge queues a session and broadcasts a browser job over SSE.
3. The MV3 service worker reconnects, recovers pending jobs, chooses a provider tab, and dispatches the job.
4. The content script claims the job with a lease token, injects text or attaches a prompt file, submits it, and captures streaming output.
5. The browser posts chunks and the final response back to the bridge.
6. Ask mode returns Markdown; agent mode parses a constrained operation response.
7. Operations are previewed, risk-classified, approved, checked against locked preconditions, and applied transactionally.

### Browser extension architecture

- MV3 service worker: `browser-extension/src/background.js`
- page adapter and response capture: `browser-extension/src/content-script.js`
- static provider registry: `browser-extension/src/providers.js`
- popup and side panel: `browser-extension/src/popup.*`, `browser-extension/src/sidepanel.*`
- local configuration and custom assets: `chrome.storage.local`
- bridge transport: authenticated fetch plus SSE
- recovery: alarms, reconnect loop, pending-job scan, dispatch retries, claim heartbeat

### Runtime architecture

There are two local Fastify runtimes:

- root bridge on port `5000`, authoritative for sessions, prompts, operations, memory, project context, and secure execution;
- workspace companion on port `5010`, authoritative for its own SQLite registry, file index, code analysis jobs, search, and export routes, while proxying prompts and memory to the root bridge.

This split is functional but creates duplicate project registries, context preview logic, path validation, process execution helpers, job records, and ZIP generation.

### Plugin architecture

No generic production plugin architecture was found.

Current plugin-like mechanisms are:

- a static provider object in `browser-extension/src/providers.js`;
- static built-in prompt, skill, and profile arrays;
- user-created prompt, skill, and profile records in `chrome.storage.local`;
- a visible-page ChatGPT Apps/Plugins scanner that discovers links but does not install or execute plugins;
- structured root tools registered through a TypeScript union and switch statement.

There is no dynamic plugin discovery, package verification, permission declaration, lifecycle API, version negotiation, dependency resolution, sandbox, or uninstall path.

## Existing Prompts

| Source | Count | Runtime status | Notes |
|---|---:|---|---|
| `src/prompts/system.ts` | 2 primary builders | Existing | Ask and agent system prompts define response and operation contracts. |
| `browser-extension/src/coding-prompts.js` | 12 | Existing | Embedded side-panel prompt cards; still the runtime source. |
| `browser-extension/prompt-library/` | 1 standalone prompt | Partial | Canonical authoring has begun; no catalog loader yet. |
| `browser-extension/bridge-server.ts` | 2 focused review prompts | Existing | Diff review and pull-request analysis routes. |
| `browser-extension/src/workspace-library.js` | 6 guidance skills and 4 profiles | Partial | Composed into prompts; not executable skill packages. |

## Existing Workflows

| Workflow | Entry point | Current state |
|---|---|---|
| Ask mode | `src/index.ts` | Builds memory and context, submits to browser AI, streams Markdown response. |
| Agent mode | `src/index.ts` | Parses operations, previews risk and diffs, requests approval, executes, verifies. |
| Browser job workflow | root bridge, `background.js`, `content-script.js` | SSE delivery, claims, retries, heartbeats, response streaming. |
| Operation preview/apply | `src/server/index.ts` | One-time approval token binds exact plans to project root. |
| Project intelligence | `src/context/`, `src/memory/`, `src/projects/` | Context, status, registry, memory, and budget preview. |
| Workspace companion | `bridge-server.ts` | Register, index, search, analyze, export, prompt, code review, PR analysis. |
| Git review | `gh-openbrowser` | Reviews staged/unstaged diff and analyzes a PR through the companion. |
| Pre-commit analysis | `hooks/pre-commit` | Advisory by default; optional blocking for high-severity findings. |
| Verification | `src/verification/`, package scripts, GitHub Actions | Quick, standard, full, root, Linux, and Windows verification paths. |

## Existing Skill Candidates

The following records are capability-level candidates, not claims that production skill packages already exist.

| ID | Name | Purpose | Category | Current implementation location | Dependencies | Inputs | Outputs | Status | Priority | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| C01 | Operation Contract Validation | Validate allowed file and tool operations and response envelopes. | Core | `src/protocol/index.ts`, `src/core/types/index.ts` | Zod | operation payload | typed operations or validation errors | Existing | P0 | Natural base contract for executable skills. |
| C02 | AI Response Parsing | Extract JSONC operations and merge file, Markdown, and YAML content. | Core | `src/parser/index.ts`, `src/parser/markdown-agent.ts` | protocol schemas | raw model response | normalized operation payload | Partial | P0 | Existing issue ledger records fence and edit-targeting edge cases. |
| C03 | Operation Ordering Normalization | Preserve safe folder, file, and tool execution order. | Core | `src/operations/operation-order.ts`, `src/operations/mkdir-normalize.ts` | operation types | operations | ordered operations | Existing | P0 | Reusable pre-execution stage. |
| C04 | Operation Planning and Diff Preview | Resolve operations against virtual state and produce risks, diffs, and preconditions. | Core | `src/operations/index.ts` | path guard, tool registry | operations and project root | planned operations | Existing | P0 | Must remain authoritative. |
| C05 | Transactional Operation Execution | Apply operations atomically with journals, backups, rollback, and history. | Core | `src/operations/index.ts` | planner, filesystem | approved plans | committed changes or rollback result | Existing | P0 | Strongest executable-skill foundation in the repository. |
| C06 | Project Path Containment | Prevent traversal, absolute paths, symlink escape, and type confusion. | Security | `src/security/project-path.ts` | filesystem realpath | root and requested path | canonical contained path | Existing | P0 | Must be shared by every filesystem skill. |
| C07 | One-Time Operation Approval | Issue and consume expiring approvals bound to exact plans and project root. | Security | `src/server/operation-approvals.ts` | crypto, planner | planned operations | approval token and validated plans | Existing | P0 | Suitable generic approval primitive. |
| C08 | Structured Tool Registry | Resolve a fixed tool ID into direct executable invocation. | Core | `src/tools/registry.ts` | Node process platform | tool ID, args, cwd | validated invocation | Partial | P0 | Secure but narrow and switch-based; needs extensible registration. |
| C09 | Tool Risk Classification | Classify read, write, network, arbitrary execution, destructive, and publish risk. | Security | `src/tools/registry.ts`, `src/operations/index.ts` | tool registry | invocation or operation | risk and approval requirement | Existing | P0 | Should become common skill policy metadata. |
| C10 | Root Project Registry | Register, resolve, activate, list, and remove local projects. | Core | `src/projects/registry.ts` | filesystem, user home | project root or ID | project record | Duplicate | P1 | Overlaps companion SQLite registry. |
| C11 | Project Memory | Persist deduplicated project decisions and constraints. | AI | `src/memory/project-memory.ts` | filesystem | text and tags | memory entries and prompt block | Partial | P1 | Atomic writes exist; concurrent writer protection is missing. |
| C12 | Project Context Scanner | Inventory files and summarize package and TypeScript metadata. | Architecture | `src/context/context-scan.ts` | fast-glob, JSONC | project root | project summary | Existing | P1 | Useful architecture-discovery primitive. |
| C13 | Budgeted Context Builder | Select, prioritize, filter, truncate, and report bounded file context. | AI | `src/context/context-budget.ts`, `browser-extension/bridge-server.ts` | path and file inspection | refs and budgets | included and excluded context metadata | Duplicate | P0 | Root and companion implementations differ. |
| C14 | Interactive Context Selection | Parse `@` references, show completions, and select files or folders. | AI | `src/context/at-picker.ts`, `src/context/at-input.ts`, `src/context/file-context.ts` | terminal input, file scan | user references | selected context attachments | Existing | P1 | CLI-specific adapter over reusable context selection. |
| C15 | Project Status Inspection | Report package, Git, project memory, and runtime status. | Architecture | `src/project/status.ts`, server status routes | Git and filesystem | project root | status model | Existing | P1 | Can feed UI and preflight skills. |
| C16 | Verification Plan Detection | Choose quick, standard, or full checks from package scripts. | Testing | `src/verification/plan.ts`, `src/verification/index.ts` | package metadata, tool registry | profile and scripts | `RUN_TOOL` verification plan | Existing | P0 | Should drive post-skill verification. |
| C17 | Prompt Delivery Selection | Choose direct injection or attached prompt file based on size. | AI | `src/shared/prompt-delivery.ts`, `browser-extension/src/job-payload.js` | prompt limits | prompt and metadata | text or file delivery payload | Duplicate | P1 | Logic exists on both root and extension sides. |
| C18 | Transaction and Edit History | Persist operation outcomes, transaction IDs, rollback status, and summaries. | Workflow | `src/memory/index.ts`, `.openbrowser/` records | executor | execution event | history entry | Partial | P1 | Current history is shallow and file-based. |
| C19 | Bridge Client and Response Timeout | Submit sessions, consume SSE, and enforce bounded response waiting. | Core | `src/client/bridge-client.ts`, `src/client/response-timeout.ts` | HTTP and SSE | prompt request | streamed or final response | Existing | P0 | General remote-skill transport candidate. |
| C20 | Terminal Agent Progress | Render step state, previews, approvals, and completion in the CLI. | Workflow | `src/shared/terminal.ts`, `src/index.ts` | terminal | workflow events | operator feedback and decisions | Existing | P2 | Keep as an interface adapter, not skill logic. |
| AI01 | Ask System Prompt Builder | Produce terminal-friendly, non-operation assistant instructions. | AI | `src/prompts/system.ts` | session mode | ask options | system prompt | Existing | P1 | Guidance skill candidate. |
| AI02 | Agent System Prompt Builder | Produce the constrained operation and file-block contract. | AI | `src/prompts/system.ts` | conversation ID and protocol | session context | agent system prompt | Existing | P0 | Closely coupled to parser and operation schema. |
| AI03 | Prompt Template Engine | Parse variables, apply defaults, filter, and normalize custom prompts. | AI | `browser-extension/src/prompt-library.js` | browser JS | prompt template and values | rendered prompt | Existing | P1 | Should be shared with standalone catalog loader. |
| AI04 | Embedded Coding Prompt Catalog | Supply twelve focused audit, development, security, review, and documentation prompts. | AI | `browser-extension/src/coding-prompts.js` | template engine | prompt selection and variables | rendered prompt | Duplicate | P1 | Canonical Markdown migration has started. |
| AI05 | Standalone Prompt Asset Specification | Define metadata, inputs, execution rules, output, validation, and failure handling. | Documentation | `browser-extension/prompt-library/foundation/tb-prompt-found-001-repository-architecture-discovery.md` | repository tools | prompt variables | deterministic report | Existing | P1 | Strong model for future skill documents. |
| AI06 | Prompt Library Governance Roadmap | Define canonical prompt placement, IDs, dependencies, and migration order. | Architecture | `.titan/todo/issues/Titan-Builder-Prompt-Library-Roadmap.md` | repository evidence | prompt inventory | catalog roadmap | Partial | P1 | Loader and most catalog assets remain planned. |
| AI07 | Guidance Skill Library | Add reusable instruction blocks for debugging, testing, security, architecture, Git, and performance. | AI | `browser-extension/src/workspace-library.js` | prompt composition | active skill IDs | instruction text | Partial | P0 | Six guidance objects are not executable skill packages. |
| AI08 | Agent Profile Composition | Combine a role, instructions, and default guidance skills. | AI | `browser-extension/src/workspace-library.js` | guidance skills | profile and active IDs | resolved workspace context | Partial | P1 | No versioning, inheritance, or capability checking. |
| AI09 | Workspace Instruction Merge | Merge active profile and skills into outbound jobs without duplicate blocks. | AI | `browser-extension/src/job-payload.js`, `background.js` | profile resolver | base system prompt and workspace context | enriched job | Existing | P1 | Important orchestration primitive. |
| AI10 | Browser AI Job Orchestration | Queue, recover, route, retry, claim, and complete browser-powered AI work. | Workflow | `src/server/index.ts`, `background.js`, `content-script.js` | bridge, SSE, provider adapters | prompt session | response or error | Existing | P0 | Core cross-runtime workflow. |
| AI11 | Response Capture and Streaming | Detect generation stability, emit chunks, and return authoritative final text. | AI | `browser-extension/src/content-script.js`, `src/server/sse-hub.ts` | provider DOM, SSE | provider response DOM | partial and final text | Partial | P0 | DOM heuristics remain provider-sensitive. |
| AI12 | Provider Target Routing | Select requested, preferred, active, or newest supported provider tab. | Browser | `browser-extension/src/prompt-routing.js`, `background.js` | Chrome tabs | open tabs and provider preference | target tab | Existing | P1 | Should consume a future adapter plugin registry. |
| B01 | Provider Adapter Registry | Define hosts, page identity, selectors, injection modes, and attachment controls. | Browser | `browser-extension/src/providers.js` | DOM | current URL and page | provider adapter | Partial | P0 | Static object; no formal adapter interface or dynamic validation. |
| B02 | Composer Injection | Insert prompts into contenteditable, textarea, Lexical, and shadow-DOM composers. | Browser | `browser-extension/src/content-script.js`, `providers.js` | provider adapter | prompt text | populated composer | Existing | P0 | Provider-specific behavior should be adapter methods. |
| B03 | Send and Stop Control | Find and activate provider send or stop controls with bounded retries. | Browser | `browser-extension/src/content-script.js`, `providers.js` | provider adapter | page state | submission or stop action | Existing | P1 | Needs fixture-based provider tests. |
| B04 | Prompt File Attachment | Attach oversized prompt files through provider-specific upload flows. | Browser | `browser-extension/src/content-script.js`, `job-payload.js` | File API, provider adapter | prompt content and filename | attached file or text fallback | Existing | P0 | Security-sensitive browser automation. |
| B05 | Attachment Verification | Correlate the expected filename and size with newly visible preview evidence. | Security | `browser-extension/src/attachment-verification.js`, `content-script.js` | DOM preview | expectation and before/after state | verified attachment result | Existing | P0 | Prevents stale attachment false positives. |
| B06 | MV3 Job Recovery | Reconnect SSE, scan pending jobs, retry dispatch, and use alarms after worker suspension. | Browser | `browser-extension/src/background.js` | Chrome alarms and tabs | bridge events and pending jobs | dispatched work | Existing | P0 | Bridge restart persistence remains incomplete. |
| B07 | Bounded Auto-Continue | Continue ask-mode responses through native controls or optional fallback prompts. | AI | `browser-extension/src/auto-continue-policy.js`, `content-script.js` | provider page | settings and completion state | continuation action | Existing | P2 | Correctly bounded and disabled outside ask mode. |
| B08 | Visible ChatGPT App Scan | Discover visible ChatGPT app, plugin, or connector candidates. | Research | `browser-extension/src/chatgpt-page-tools.js`, `sidepanel.js` | visible ChatGPT DOM | current page | cached link records | Partial | P2 | Discovery only; not an installable plugin system. |
| B09 | Visible ChatGPT File Scan | Discover visible downloadable file candidates in ChatGPT. | Research | `browser-extension/src/chatgpt-page-tools.js`, `sidepanel.js` | visible ChatGPT DOM | current page | file records | Partial | P2 | Coverage is heuristic and visible-page only. |
| B10 | Conversation Reply Capture | Collect and deduplicate visible assistant replies for export. | Documentation | `browser-extension/src/chatgpt-page-tools.js` | conversation DOM | current page | reply records | Existing | P2 | Useful capture adapter. |
| B11 | Browser Markdown Export | Export selected files and replies as a structured Markdown report. | Documentation | `browser-extension/src/file-exporter.js`, `sidepanel.js` | selected records | export metadata | Markdown file | Existing | P2 | UI adapter over reusable formatter. |
| B12 | Browser ZIP Export | Assemble classic ZIP bytes in-browser with CRC32 and safe names. | Automation | `browser-extension/src/file-exporter.js` | browser binary APIs | named byte entries | ZIP bytes | Duplicate | P1 | Companion separately uses `yazl`; unify contract, not necessarily implementation. |
| B13 | Side Panel Workspace | Present prompts, projects, memory, custom assets, skills, agents, plugins, library, export, settings, and status. | Browser | `browser-extension/src/sidepanel.js`, `sidepanel.html` | Chrome storage and bridge | user actions | state changes and workflows | Partial | P1 | Large monolithic controller; needs modular skill-driven views. |
| B14 | Bridge Configuration and Provider Preference | Persist bridge port, token, provider, compatibility, auto-continue, profile, and active skill settings. | Browser | `browser-extension/src/bridge-config.js`, `sidepanel.js` | Chrome storage | settings | normalized bridge config | Existing | P1 | Future skill settings should use a scoped configuration contract. |
| S01 | Bridge Security Policy | Enforce separate principals, strong tokens, route scopes, origin pinning, and constant-time comparison. | Security | `src/server/security.ts` | crypto, request metadata | route, origin, bearer token | authorization decision | Existing | P0 | Foundation for remote skill invocation. |
| S02 | Session Claim Lease | Claim, renew, release, expire, and complete browser jobs. | Security | `src/server/session-store.ts` | in-memory map, crypto | session ID and claim token | leased session transition | Partial | P0 | Secure lease semantics exist; persistence and retention do not. |
| S03 | Sensitive Context Filter | Exclude credentials, keys, environment files, binary data, and ignored paths. | Security | `src/context/context-budget.ts` | path classification | candidate path | include or exclusion reason | Existing | P0 | Must be mandatory for context-producing skills. |
| S04 | Safe External Process Execution | Execute argument arrays without a shell, with timeouts and bounded output. | Security | `src/operations/index.ts`, `browser-extension/bridge-server.ts` | child process API | executable, args, cwd | stdout, stderr, exit result | Duplicate | P0 | Two implementations should share one policy contract. |
| S05 | Archive and Export Guardrails | Reject traversal, duplicate paths, symlinks, oversized bodies, and unsafe archive names. | Security | `file-exporter.js`, `bridge-server.ts`, `.github/workflows/apply-ob009.yml` | path and size checks | export or archive entries | safe archive or error | Duplicate | P0 | Consolidate validation rules across ZIP and repair artifacts. |
| CD01 | Ripgrep Project Search | Search active projects using safe fixed or regex argument arrays. | Code | `browser-extension/bridge-server.ts` | ripgrep | pattern, path, regex flag | structured matches | Existing | P1 | Excellent standalone search skill. |
| CD02 | SHA File Indexing | Watch, hash, sort, and persist project file metadata. | Code | `browser-extension/bridge-server.ts`, `schema.sql` | chokidar, SHA-256, SQLite | active project | file index and progress | Existing | P1 | Suitable prerequisite for incremental analysis. |
| CD03 | Python AST Analysis | Report imports, exports, complexity, metrics, security findings, and code smells without executing code. | Code | `browser-extension/analysis_tools.py` | Python standard library | project or file paths | structured analysis | Existing | P1 | Language-specific but well bounded. |
| CD04 | JS, TS, and JSON Staged Analysis | Detect a small set of dynamic execution, shell, TLS, and invalid JSON risks. | Code | `browser-extension/bridge-server.ts` | text rules | staged files | issues and blocking count | Partial | P1 | Not parser-based and explicitly narrow. |
| CD05 | Diff Code Review | Ask the browser AI for correctness, security, data-loss, compatibility, and test findings grounded in a diff. | Code | `browser-extension/bridge-server.ts` | prompt route, main bridge | Git diff | review response | Existing | P1 | Prompt should later become a catalog dependency. |
| CD06 | Pull Request Diff Analysis | Summarize PR intent, risks, breaking changes, tests, and review actions. | GitHub | `browser-extension/bridge-server.ts`, `gh-openbrowser` | GitHub CLI and prompt route | PR number and diff | PR analysis | Partial | P1 | Depends on local `gh`; no native repository write lifecycle. |
| CD07 | SQLite Workspace State | Store projects, settings, jobs, file index, and analysis metadata with WAL and constraints. | Architecture | `browser-extension/schema.sql`, `bridge-server.ts` | better-sqlite3 | workspace events | persistent records | Duplicate | P0 | Competes with JSON registries and in-memory root sessions. |
| G01 | Structured Git Read Tools | Expose status, diff, log, and current branch as validated no-shell tools. | GitHub | `src/tools/registry.ts` | Git executable | approved tool ID | command result | Existing | P1 | Read-only coverage is strong but small. |
| G02 | GitHub CLI Workspace Commands | Register repositories, review diffs, and analyze pull requests from `gh openbrowser`. | GitHub | `browser-extension/gh-openbrowser` | Bash, curl, jq, git, gh | subcommand and repository state | companion API result | Partial | P1 | No branch creation, commit, push, issue, or PR creation. |
| A01 | Pre-Commit Analysis Gate | Analyze supported staged files and optionally block high-severity findings or analysis failure. | Automation | `browser-extension/hooks/pre-commit` | Git, curl, jq, companion | staged paths | advisory or blocking result | Existing | P1 | Policy mode is explicit and safe by default. |
| A02 | PowerShell Workspace Manager | Start, stop, restart, register, search, analyze, index, and install hooks. | Automation | `browser-extension/openbrowser.ps1` | PowerShell, pnpm, companion | command and project path | process or API action | Existing | P2 | Windows-focused adapter; process ownership is carefully bounded. |
| A03 | Workspace Health Dashboard | Display bridge, database, project, CPU, memory, and disk status with optional refresh. | Automation | `browser-extension/dashboard.ps1` | PowerShell, companion | watch settings | terminal dashboard | Existing | P3 | Operator surface, not core skill logic. |
| A04 | VS Code Tasks and Prompt Snippets | Expose installation, lifecycle, project, analysis, and prompt actions to VS Code. | Automation | `browser-extension/.vscode/`, `browser-extension/README.md` | VS Code | task selection | local command or prompt | Existing | P2 | Keep as adapter generated from skill metadata where possible. |
| A05 | Progress Event Broadcasting | Send indexing, analysis, session, and browser job progress over WebSocket or SSE. | Workflow | `bridge-server.ts`, `src/server/sse-hub.ts` | WebSocket, SSE | job events | subscribed progress stream | Duplicate | P1 | Two transports need one event envelope and lifecycle contract. |
| T01 | Root Runtime Test Suite | Verify config, paths, operations, transactions, tools, server security, sessions, context, memory, and extension modules. | Testing | `src/**/*.test.ts`, root package scripts | Vitest and Node | source tree | test results | Existing | P0 | Provides extraction safety net. |
| T02 | Companion TypeScript and Python Tests | Verify companion server and analyzer behavior. | Testing | `browser-extension/bridge-server.test.ts`, `browser-extension/tests/` | Vitest, unittest | companion source | test results | Existing | P0 | Separate dependency boundary is intentional today. |
| T03 | Extension Module Tests | Verify routing, payloads, attachment checks, exports, auto-continue, prompts, skills, and project intelligence. | Testing | `browser-extension/src/*.test.mjs` | Node test runner | extension modules | test results | Existing | P0 | No full browser E2E harness found. |
| D01 | Root Verification CI | Install locked dependencies and run the complete root verification pipeline. | DevOps | `.github/workflows/verify.yml` | GitHub Actions, Node 22, pnpm | push, PR, dispatch | CI status | Existing | P0 | Protects root extraction work. |
| D02 | Companion Cross-Platform CI | Verify Linux and Windows companion builds, scripts, tests, and root compatibility. | DevOps | `.github/workflows/workspace-tools.yml` | GitHub Actions, Node, Python, PowerShell | PR or dispatch | CI status | Existing | P0 | Strong cross-platform boundary. |
| D03 | Verified Repair Artifact Workflow | Download a checksum-pinned archive, validate exact safe members, run offline verification, and commit a repair. | DevOps | `.github/workflows/apply-ob009.yml` | Actions, curl, Python, Git | PR or dispatch | verified branch commit | Partial | P2 | One-off branch-specific workflow, not a reusable deployment skill. |

## Missing Skills

| ID | Name | Purpose | Category | Current implementation location | Dependencies | Inputs | Outputs | Status | Priority | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| M01 | Titan Skill Manifest Schema | Define stable ID, version, type, category, runtime, handler, schemas, dependencies, permissions, compatibility, tests, and ownership. | Core | None; proposed `browser-extension/skill-library/schema/` | JSON Schema or Zod | manifest document | validated manifest | Missing | P0 | First prerequisite for every production skill. |
| M02 | Canonical Skill Package Layout | Define where manifests, instructions, handlers, fixtures, examples, and docs live. | Architecture | None; proposed `browser-extension/skill-library/` | M01 | skill type | canonical paths | Missing | P0 | Must prevent parallel authoring trees. |
| M03 | Skill Registry and Discovery | Discover built-in and custom skill packages deterministically. | Core | None; proposed `browser-extension/src/skills/registry.*` | M01, M02 | library roots | indexed skill records | Missing | P0 | Replace static arrays without breaking current IDs. |
| M04 | Skill Loader and Compatibility Layer | Load standalone assets and preserve current embedded skills and storage records during migration. | Core | None | M01-M03 | registry record | loaded skill | Missing | P0 | Required before Markdown or package assets become runtime sources. |
| M05 | Skill Router and Selection | Choose skills from intent, explicit selection, profile, runtime availability, and policy. | AI | None | M03, M07, M08 | task context and catalog | ranked skill set | Missing | P0 | Current routing is only manual active IDs. |
| M06 | Skill Dependency Resolver | Validate prerequisite graphs, detect cycles, and produce execution order. | Workflow | None | M01, M03 | selected skill IDs | resolved DAG | Missing | P0 | Needed for composed production workflows. |
| M07 | Skill Input and Output Contract | Validate typed skill inputs, outputs, errors, artifacts, and streaming events. | Core | None | M01 | invocation payload | typed result envelope | Missing | P0 | Reuse Zod patterns from the operation protocol. |
| M08 | Skill Capability and Permission Declaration | Declare filesystem, browser, network, Git, process, secret, and publish capabilities. | Security | None | M01, C09 | manifest and environment | authorization decision | Missing | P0 | Should map to existing risk and approval primitives. |
| M09 | Skill Lifecycle and Execution Contract | Define initialize, validate, plan, approve, execute, verify, rollback, and dispose hooks. | Core | None | M06-M08 | loaded skill and invocation | lifecycle result | Missing | P0 | Wrap existing transactional execution rather than replace it. |
| M10 | Skill Result and Error Envelope | Standardize status, evidence, warnings, files, metrics, rollback, and actionable errors. | Core | None | M07, M09 | handler outcome | normalized result | Missing | P0 | Required across extension, root bridge, and companion. |
| M11 | Skill Configuration and Secret Contract | Scope settings and secret references without embedding sensitive values in manifests or prompts. | Security | None | M01, M08 | config schema and references | resolved safe config | Missing | P0 | Extend bridge and Chrome storage patterns carefully. |
| M12 | Skill Semantic Versioning and Migration | Define compatibility ranges, migrations, supersession, deprecation, and aliases. | Architecture | None | M01, M04 | old and new versions | migration decision | Missing | P0 | Critical for current built-in ID compatibility. |
| M13 | Skill Catalog Index Generator | Generate deterministic category, dependency, compatibility, and search indexes. | Documentation | None | M01-M04 | skill library | generated catalog | Missing | P1 | Do not hand-edit generated indexes. |
| M14 | Skill Validator and Linter | Check manifest, paths, references, dependency graph, permission declarations, handler exports, and documentation. | Testing | None | M01-M13 | skill package | diagnostics | Missing | P0 | Should run locally and in CI. |
| M15 | Skill Scaffolder and Writer | Create a conforming skill package from validated metadata and selected runtime type. | Code | None | M01, M02, M14 | skill specification | package skeleton | Missing | P1 | Generate only after contracts stabilize. |
| M16 | Skill Test Harness and Fixtures | Run contract, unit, integration, negative, rollback, and compatibility tests. | Testing | None | M07-M10, M14 | skill and fixtures | test evidence | Missing | P0 | Extraction should fail without regression tests. |
| M17 | Skill Sandbox and Isolation | Restrict untrusted or third-party handlers by capability, runtime, timeout, memory, and filesystem boundary. | Security | None | M08-M11 | skill invocation | isolated result | Missing | P1 | Required before third-party installation. |
| M18 | Skill Provenance and Audit Log | Record source, version, hash, signer, invocation, approval, result, and artifacts. | Security | None | M01, M10 | lifecycle events | immutable audit record | Missing | P1 | Build on transaction journals and companion job history. |
| M19 | Skill Install, Update, Disable, and Uninstall | Manage lifecycle of built-in, local, and future remote skill packages. | DevOps | None | M12, M13, M17, M18 | package source and action | installed catalog state | Missing | P2 | Do not enable remote installs before signing and sandboxing. |
| M20 | Skill Workflow Composition DSL | Compose skills with dependencies, conditions, approvals, retries, rollback, and artifacts. | Workflow | None | M06-M10 | workflow definition | executable workflow plan | Missing | P1 | Existing ask, agent, and companion flows can become reference workflows. |
| M21 | Skill Telemetry and Observability | Standardize timing, progress, resource use, retries, findings, and completion metrics. | Automation | None | M10, M18 | lifecycle events | metrics and traces | Missing | P1 | Unify SSE and WebSocket event shapes. |
| M22 | Unified Project State Store | Resolve JSON registry, SQLite registry, project memory, active project, session, job, index, and history ownership. | Architecture | None | M01, migration plan | existing state stores | one authoritative state model | Missing | P0 | Highest architectural consolidation dependency. |
| M23 | Shared Process and Archive Utilities | Centralize no-shell process policy, size limits, path normalization, ZIP validation, and output bounds. | Security | None | C06, S04, S05 | process or archive request | policy-compliant result | Missing | P0 | Removes repeated security logic. |
| M24 | Provider Adapter Plugin API | Define provider identity, selectors, injection, attachment, response, completion, and test fixture interfaces. | Browser | None | M01, M04, B01 | adapter package | validated provider adapter | Missing | P0 | Extract current static providers without changing behavior. |
| M25 | Side Panel Skill Extension Slots | Render skill-supplied forms, status, actions, results, and settings without growing one controller. | Browser | None | M03-M05, M07 | skill UI metadata | modular panel surface | Missing | P1 | Decompose `sidepanel.js` incrementally. |
| M26 | Persistent Session and Job Store | Persist queued, claimed, partial, complete, and failed sessions with retention and restart recovery. | Workflow | None | M22 | session events | durable session state | Missing | P0 | Current root session map is process-local. |
| M27 | Native GitHub Repository Lifecycle | Inspect repository, create branch, write files, commit, push, open PR, comment, label, and report CI under explicit policy. | GitHub | None in product runtime | M08-M10, GitHub auth | repository task | GitHub mutations and evidence | Missing | P1 | Current repository support is read-focused and CLI-dependent. |
| M28 | Web Research and Citation | Search current primary sources, retrieve documents, preserve citations, and distinguish repository evidence from external evidence. | Research | None | M07, network permission | research question | cited research bundle | Missing | P2 | Required for standards and current platform behavior. |
| M29 | Skill Documentation Generator | Generate reference, examples, permissions, dependencies, troubleshooting, and migration docs from manifests and tests. | Documentation | None | M01, M13, M16 | skill package | generated docs | Missing | P1 | Documentation should derive from authoritative metadata. |
| M30 | Browser End-to-End Provider Harness | Test real or fixture provider pages, MV3 suspension, messaging, attachments, streaming, selectors, and recovery. | Testing | None | M24, M16 | adapter fixtures and scenarios | E2E evidence | Missing | P0 | Current tests are module-level, not full browser workflows. |
| M31 | Skill Release Packaging and Signing | Build reproducible packages, hashes, signatures, SBOM, compatibility metadata, and release artifacts. | DevOps | None | M14-M19 | validated package | signed release | Missing | P2 | Required before distribution or marketplace use. |
| M32 | Central Skill Policy Engine | Evaluate identity, capability, risk, project scope, approval, rate, and environment policies consistently. | Security | None | M08, C07, C09, S01 | invocation context | allow, deny, or approval requirement | Missing | P0 | Prevent policy drift across two bridges and the extension. |

## Duplicate Functionality

| Area | Current implementations | Risk | Recommended treatment |
|---|---|---|---|
| Project registry | `src/projects/registry.ts`; companion `projects` table | Active-project and metadata drift | Create one project-state contract and migrate to a single authoritative store. |
| Context preview | `src/context/context-budget.ts`; `bridge-server.ts` | Different defaults, sensitive filtering, and outputs | Retain root policy as canonical and expose it through adapters, or extract a shared package. |
| Prompt delivery sizing | `src/shared/prompt-delivery.ts`; `job-payload.js` | Root and extension can disagree after workspace instructions are added | Define one shared payload contract and test both sides against fixtures. |
| Path containment | `src/security/project-path.ts`; companion normalization and realpath functions | Security fixes can land in only one runtime | Centralize policy and maintain runtime-specific thin adapters. |
| External process execution | root executor and companion `runProcess` | Timeout, buffer, executable, and logging policy drift | Extract common invocation and policy types. |
| ZIP export | browser custom ZIP; companion `yazl` ZIP | Different features and safety checks | Keep runtime-appropriate encoders behind one export skill contract. |
| Progress events | root SSE hub; companion WebSocket broadcast | UI integrations need two event models | Adopt one event envelope with transport adapters. |
| Job records | root in-memory sessions; companion SQLite `job_history` | Restart loss and incomplete cross-runtime tracing | Implement persistent session/job state and common IDs. |
| Prompt assets | embedded JS catalog; standalone Markdown prompt library | Runtime and canonical authoring can drift | Implement catalog loader and compatibility aliases before removing JS bodies. |
| Skills and profiles | built-in JS arrays; custom Chrome storage records; proposed standalone library | No singular schema or migration path | Introduce manifest, loader, and storage migration under stable IDs. |
| Review prompts | coding prompt cards; companion hardcoded diff and PR prompts | Quality and policy changes can diverge | Move prompt bodies to canonical prompt assets referenced by review skills. |
| Verification | root profiles; companion package scripts; two CI workflows | Skill verification can become runtime-specific | Create a verification skill contract that delegates to each runtime. |

## Missing Abstractions

The most important missing abstractions are:

1. **Skill identity and manifest** — no stable production schema exists.
2. **Definition versus implementation** — prompt instructions, executable handlers, UI adapters, and workflows are currently conflated.
3. **Cross-runtime handler contract** — extension, root bridge, and companion expose different request and result shapes.
4. **Dependency and capability graph** — active skill IDs are concatenated, not resolved or authorized.
5. **Persistent lifecycle state** — root sessions are in memory and project state is duplicated.
6. **Provider adapter interface** — providers are static configuration plus shared procedural code.
7. **Validation and test contract** — no skill-level validator, fixtures, or compatibility suite exists.
8. **Installation and provenance** — there is no signed package, source record, migration, disable, or uninstall model.
9. **Central policy** — approval, origin, path, process, context, and archive policies exist but are distributed.
10. **Catalog-derived UI and documentation** — side-panel forms and docs are handwritten rather than generated from skill metadata.

## Skill Categories

| Category | Scope | Current candidate count | Missing foundation count | Projected count |
|---|---|---:|---:|---:|
| Core | contracts, registry, loading, execution, results | 14 | 10 | 24 |
| Browser | provider automation, extension lifecycle, UI | 12 | 3 | 15 |
| GitHub | Git inspection and repository lifecycle | 4 | 1 | 5 |
| AI | prompts, context, profiles, routing, capture | 14 | 1 | 15 |
| Code | search, index, static analysis, review | 6 | 1 | 7 |
| Architecture | state, boundaries, migration, discovery | 6 | 3 | 9 |
| Security | identity, paths, approvals, policy, isolation | 7 | 6 | 13 |
| Research | visible discovery and external research | 2 | 1 | 3 |
| Documentation | prompt assets, exports, generated references | 3 | 2 | 5 |
| Automation | hooks, managers, dashboards, telemetry | 5 | 1 | 6 |
| Workflow | sessions, orchestration, history, composition | 5 | 3 | 8 |
| Testing | root, companion, extension, E2E harness | 3 | 3 | 6 |
| DevOps | CI, repair automation, install, packaging | 4 | 3 | 7 |

Category counts overlap where a skill has a primary category but several cross-cutting dependencies. The authoritative projected unique count is recorded below.

## Estimated Skill Count

| Measure | Count | Interpretation |
|---|---:|---|
| Current objects explicitly labeled as skills | 6 | Guidance-only instruction records in `workspace-library.js`. |
| Current production executable skill packages | 0 | No package satisfies a manifest, handler, permission, dependency, lifecycle, and test contract. |
| Current reusable capability candidates | 71 | Existing, partial, and duplicate capabilities listed in this roadmap. |
| Missing foundation and production candidates | 32 | New capabilities required for a coherent production library. |
| Total projected production library | 103 | Capability-level estimate after extraction and foundation work. |

The estimate counts one stable skill per user-meaningful capability, not one skill per source file, route, provider selector, or UI button.

## Canonical Skill Architecture

### Authoring source

Use:

`browser-extension/skill-library/<category>/<skill-id>/`

Recommended contents:

- `skill.md` — human-readable purpose, usage, constraints, examples, and failure handling;
- `skill.json` — machine-readable manifest conforming to M01;
- `fixtures/` — valid, invalid, compatibility, and security fixtures;
- `examples/` — non-authoritative usage examples;
- optional runtime-specific adapter references, never duplicated implementation bodies.

### Runtime sources

- `browser-extension/src/skills/` — loader, registry, router, catalog activation, extension adapters, and side-panel integration.
- `src/skills/` — root bridge adapters that call existing operation, context, memory, verification, Git, and server services.
- companion runtime adapters should initially remain beside `bridge-server.ts`, then move into a shared package only after state and utility ownership is resolved.

### Skill types

Every manifest should declare one type:

- `guidance` — instructions composed into a prompt;
- `prompt` — a parameterized canonical prompt asset;
- `executable` — a handler with typed input and output;
- `adapter` — provider, UI, transport, or platform integration;
- `workflow` — a dependency graph of other skills;
- `policy` — authorization, validation, approval, or safety decision;
- `reporter` — transforms evidence into a human-readable artifact.

### Runtime targets

Allowed targets should be explicit:

- `extension-service-worker`
- `extension-content-script`
- `extension-side-panel`
- `root-bridge`
- `workspace-companion`
- `cli`
- `github-actions`
- `prompt-only`

### Compatibility rule

A skill may have several runtime adapters, but it must have one stable ID, one canonical manifest, one input/output contract, and one ownership record.

## Priority Order and Recommended Build Sequence

### Phase 0 — Foundation freeze

1. M01 Titan Skill Manifest Schema.
2. M02 Canonical Skill Package Layout.
3. M07 Input and Output Contract.
4. M08 Capability and Permission Declaration.
5. M09 Lifecycle and Execution Contract.
6. M10 Result and Error Envelope.
7. M12 Versioning and Migration.
8. M14 Validator and Linter.
9. Record the decision in an architecture document before extracting runtime code.

Exit condition: a sample guidance skill and a sample executable skill validate without changing current runtime behavior.

### Phase 1 — Loader, registry, and compatibility

1. M03 Registry and Discovery.
2. M04 Loader and Compatibility Layer.
3. M06 Dependency Resolver.
4. M05 Router and Selection.
5. M13 Catalog Index Generator.
6. Preserve six current skill IDs, four profile IDs, custom Chrome storage records, and embedded prompt cards through aliases and migrations.

Exit condition: the side panel can load standalone skill definitions while existing users see the same active skills and profiles.

### Phase 2 — Extract secure core skills

Extract in this order:

1. C06 Project Path Containment.
2. C01 Operation Contract Validation.
3. C03 Operation Ordering.
4. C04 Operation Planning.
5. C07 Approval Tokens.
6. C09 Risk Classification.
7. C08 Structured Tool Registry.
8. C05 Transactional Execution.
9. C16 Verification Planning.
10. S01 Bridge Security Policy.

Exit condition: root behavior and test evidence remain unchanged, and all extracted skills expose typed plans and results.

### Phase 3 — Consolidate state and shared policy

1. M22 Unified Project State Store.
2. M26 Persistent Session and Job Store.
3. M23 Shared Process and Archive Utilities.
4. M32 Central Skill Policy Engine.
5. M18 Provenance and Audit Log.
6. M21 Telemetry and Observability.

Exit condition: root and companion no longer maintain competing project or job truth, and restarts preserve pending work.

### Phase 4 — Context, memory, analysis, and Git

1. C13 Budgeted Context Builder.
2. S03 Sensitive Context Filter.
3. C11 Project Memory.
4. CD01 Ripgrep Search.
5. CD02 File Indexing.
6. CD03 Python AST Analysis.
7. CD04 Staged Analysis.
8. G01 Git Read Tools.
9. M27 Native GitHub Repository Lifecycle.

Exit condition: code and repository skills share the same permissions, evidence, result, and progress contracts.

### Phase 5 — Browser and provider extraction

1. M24 Provider Adapter Plugin API.
2. Extract B01-B06 and AI11-AI12 behind adapter fixtures.
3. M30 Browser End-to-End Provider Harness.
4. M25 Side Panel Skill Extension Slots.
5. Decompose `sidepanel.js` by view and skill metadata without a redesign.

Exit condition: each provider adapter can be validated independently and MV3 suspension/recovery is covered end to end.

### Phase 6 — Prompt, guidance, agent, and workflow migration

1. Load standalone prompt assets through the prompt catalog.
2. Convert AI07 guidance objects into conforming guidance skills.
3. Convert AI08 profiles into agent assets that reference stable skill IDs.
4. Move hardcoded review prompts to canonical prompt assets.
5. Implement M20 Workflow Composition DSL.
6. Represent ask, agent, code review, PR analysis, pre-commit, and verification as reference workflows.

Exit condition: embedded bodies are removable only after compatibility tests prove equivalent behavior.

### Phase 7 — Distribution and ecosystem

1. M15 Scaffolder and Writer.
2. M29 Documentation Generator.
3. M17 Sandbox and Isolation.
4. M19 Install, Update, Disable, and Uninstall.
5. M31 Release Packaging and Signing.
6. M28 Web Research and Citation.

Exit condition: locally authored and third-party skills can be installed, verified, disabled, audited, and removed safely.

## Dependency Relationships

```text
M01 Manifest
 ├─> M02 Package Layout
 ├─> M07 Input/Output Contract
 ├─> M08 Permissions
 └─> M12 Versioning

M02 + M07 + M08 + M12
 └─> M14 Validator
      ├─> M03 Registry
      │    ├─> M04 Loader
      │    │    ├─> M05 Router
      │    │    └─> M13 Catalog Index
      │    └─> M06 Dependency Resolver
      └─> M16 Test Harness

M06 + M07 + M08
 └─> M09 Lifecycle
      ├─> M10 Result Envelope
      ├─> M20 Workflow Composition
      ├─> M21 Telemetry
      └─> M32 Policy Engine

M22 Unified State
 ├─> M26 Persistent Sessions
 ├─> C10 Project Registry consolidation
 ├─> C11 Memory consolidation
 └─> CD07 SQLite state consolidation

M24 Provider API + M16 Test Harness
 └─> B01-B06 provider/browser skills
      └─> M30 Browser E2E Harness

M14 + M16 + M17 + M18
 └─> M19 Installation Lifecycle
      └─> M31 Packaging and Signing
```

## Security Requirements

Every executable, adapter, workflow, or installation skill must:

- declare capabilities and runtime targets;
- use canonical project-path containment for filesystem access;
- avoid shell execution unless an explicitly approved legacy boundary requires it;
- lock mutable execution inputs before approval;
- use one-time approvals for destructive, arbitrary, network-write, or publish effects;
- exclude sensitive context by default;
- bound file size, output size, execution time, retries, and event retention;
- record source, version, hash, approvals, result, and rollback status;
- avoid placing raw secrets in prompts, manifests, logs, or browser storage exports;
- provide negative tests for traversal, symlink escape, command injection, stale approvals, origin confusion, archive abuse, and restart recovery.

## Testing Strategy

### Contract tests

Each skill must validate:

- manifest structure;
- stable ID and semantic version;
- input and output schemas;
- declared dependencies;
- declared capabilities and risk;
- handler presence for executable types;
- deterministic error envelope.

### Regression tests

Extraction must preserve current tests before deleting or moving implementation. The initial extraction should wrap existing functions rather than rewrite them.

### Integration tests

Required cross-runtime paths are:

- CLI to root bridge;
- root bridge to extension background;
- background to content script;
- content script to provider fixture;
- provider response to parser;
- preview to approval to transactional execution;
- root bridge to companion proxy;
- Git hook and GitHub CLI wrapper to companion;
- restart recovery for sessions and jobs.

### Compatibility tests

Maintain fixtures for:

- six existing built-in skill IDs;
- four existing agent profile IDs;
- current custom prompt, skill, and profile storage records;
- twelve embedded prompt IDs;
- root operation response format;
- current bridge routes;
- provider routing keys.

## Documentation Strategy

Documentation should be generated or checked against manifests where possible. Each skill should expose:

- purpose and non-goals;
- category and owner;
- version and compatibility;
- required and optional inputs;
- outputs and artifacts;
- dependencies;
- capabilities and approval behavior;
- runtime targets;
- examples;
- failure handling;
- verification commands;
- migration and deprecation notes.

## Risks and Constraints

1. **Parallel architecture risk** — adding a new library without migrating static arrays would create a third source of truth.
2. **State migration risk** — project and session consolidation can lose active state unless dual-read, single-write migration is staged.
3. **Security regression risk** — generic extensibility can weaken the current fixed tool allowlist and path rules.
4. **Provider volatility** — browser selectors change and require fixtures, health checks, and graceful degradation.
5. **Prompt drift** — standalone assets and embedded runtime bodies will diverge until loader migration completes.
6. **Over-fragmentation** — splitting every helper into a skill would increase orchestration cost; skill boundaries should match user-meaningful capabilities.
7. **Cross-platform drift** — Linux, Windows, browser, and Node runtimes require shared contracts but may need different adapters.
8. **Unbounded ecosystem risk** — remote installation should remain disabled until sandboxing, provenance, signing, and uninstall are implemented.

## Immediate Next Issues

Recommended implementation issues, in order:

1. Define Titan Skill Manifest Schema and examples.
2. Define canonical skill package layout and architecture decision.
3. Build skill validator and negative fixtures.
4. Build registry, loader, and compatibility aliases for current skills.
5. Build input/output, permission, lifecycle, and result contracts.
6. Extract path containment and operation validation as first executable skills.
7. Add persistent session/job design and unified project-state migration plan.
8. Define provider adapter plugin API and fixture model.
9. Add full browser E2E harness.
10. Add native GitHub lifecycle skill after central policy and approval integration.

## Validation Record

- [x] Repository resolved through the authenticated GitHub connector.
- [x] Feature branch created from `main` and kept isolated from `main`.
- [x] `browser-extension/` analyzed, including manifest, service worker, content script, providers, side panel, prompt/skill/profile libraries, exports, companion runtime, analyzer, scripts, hooks, and CI.
- [x] `src/` analyzed, including CLI, server, security, sessions, protocol, parser, operations, tools, context, memory, projects, verification, and tests.
- [x] Supporting workflows, current issue ledger, prompt-library roadmap, and architecture records inspected.
- [x] Existing prompts, skills, workflows, runtime boundaries, reusable systems, duplicates, and missing abstractions recorded.
- [x] Roadmap path did not exist before creation; no existing file was replaced.
- [x] Only this roadmap is intended to be committed on the feature branch.
- [x] `main` is not modified by this roadmap commit.

## Final Recommendation

Treat Titan Builder's current implementation as a rich capability source, not as a finished skill architecture.

Build the library contract first. Then wrap and extract existing proven functions in dependency order. Preserve the root bridge as the secure execution authority, preserve the browser extension as the user-facing skill and provider surface, and eliminate duplicate state and policy through shared contracts rather than a broad rewrite.
