# Tool Library Expansion

Status: Implementation complete; verification and review in progress
Branch: `feature/tool-library-expansion`
Pull request: #18 (draft)
Started: 2026-08-02

## Existing tools discovered

The authoritative execution path is `RUN_TOOL` through `src/protocol/index.ts`, `src/operations/index.ts`, and `src/tools/registry.ts`.

Original approved tools:

- `git.status`
- `git.diff`
- `git.log`
- `git.branch.current`
- `npm.install`
- `npm.test`
- `npm.run`
- `pnpm.install`
- `pnpm.test`
- `pnpm.run`
- `node.version`
- `vscode.open`

Existing execution safeguards include structured arguments, `shell: false`, project-root containment, locked tool input files, operation preconditions, transactional file rollback, risk classification, approval tokens, bridge authentication, and extension-origin restrictions.

## Implemented in this pass

- Strict versioned tool manifests with complete production specification fields.
- Trusted built-in definitions separated from public manifest metadata.
- Immutable, deterministic catalog registration with canonical ID and alias collision protection.
- Backward-compatible `src/tools/registry.ts` facade.
- Compatibility tests for all existing command templates, risks, input locks, and Windows command-shim behavior.
- New tools:
  - `git.root`
  - `git.branch.list`
  - `git.remote.list`
  - `git.show`
- Deterministic, database-agnostic Knowledge Engine records.
- Authenticated shared `GET /tools` bridge endpoint.
- Browser access through the existing authenticated `BRIDGE_REQUEST` path without new extension permissions or execution bypasses.
- Dedicated unit, failure, security, and integration tests included in repository verification.
- Permanent tool-authoring documentation in `docs/tool-library.md`.

## Remaining missing tools

These remain roadmap items rather than hidden partial implementations:

- Contained workspace read/search tool package.
- Authoritative SQLite read/query tool once the SQLite Knowledge Engine service interface exists.
- Provider-backed GitHub tool package once an injectable GitHub runtime exists.
- Browser inspection package with an explicit session/origin permission model.
- Documentation generation tools backed by the Documentation Engine.
- Signed or allow-listed external tool package loader.
- Tool SDK generator.

## Architecture observations

- `src/tools/registry.ts` remains the authoritative compatibility integration point.
- `src/operations/index.ts` continues to own planning and execution; no parallel executor was introduced.
- `src/protocol/index.ts` still accepts a bounded string tool ID and delegates authorization to the registry.
- `src/server/index.ts` remains the bridge API boundary; `/tools` is registered through the existing browser-workflow route module.
- The manifest-driven Skill Library under `src/skills/` provided the strongest reusable pattern for validation and immutable registration.
- `browser-extension/src/background.js` already proxies authenticated bridge requests, so no new host permission or service-worker execution path was required.

## Integration risks

- Registry refactoring can silently change command arguments, Windows `.cmd` wrapping, risk levels, or approval behavior. Dedicated compatibility tests now cover these invariants.
- Runtime-loaded executable definitions would be unsafe unless resolver trust, signature/allow-list verification, package containment, and compatibility enforcement are implemented.
- Git revision arguments are option-injection vectors. `git.show` uses a strict revision grammar and a final `--` separator.
- Tool listing can disclose implementation or environment details. The endpoint exposes manifests and normalized knowledge records only.
- Browser discovery must not become browser execution. Actual tool execution remains routed through operation preview, risk classification, and approval.

## Dependency changes

- No runtime or development dependency was added.
- Existing `zod`, Node.js 22 APIs, Fastify, and current test runners are sufficient.

## Technical debt

- The product and package still retain the upstream OpenBrowser identity in several locations.
- Built-in definitions are intentionally centralized in `src/tools/catalog.ts`; as the catalog grows, category modules should be introduced without changing registry semantics.
- The required SQLite Knowledge Engine is not yet visible as an authoritative runtime service in the audited path; this pass exports normalized metadata without inventing a second database layer.
- Documentation Engine, Writer Studio, Conversation Engine, and Feature Evolution Engine are not represented as direct injectable services in the current tool path. Integration currently occurs through metadata, documentation, prompts/context, and the existing operation runtime.
- The authenticated `/tools` route is registered in `browser-workflow-routes.ts` because that module is already wired into server creation. A future server route decomposition may move it into a focused tool route module.

## Security observations

- Every tool preserves `shell: false`.
- Control characters and excessive arguments are rejected centrally.
- Project path containment remains enforced by existing operation and workspace security services.
- `git.remote.list` returns remote names only, not credential-bearing URLs.
- `git.show` rejects option prefixes, ranges, reflogs, ancestry operators, pathspec syntax, whitespace, and backslashes.
- High-side-effect tools continue to require explicit approval.
- Tool manifests are strict, versioned, deterministic, and deeply immutable.
- Catalog objects and knowledge records are immutable.
- `/tools` requires an authenticated control client or authenticated/pinned browser-extension origin.
- Discovery responses exclude executable paths, resolver functions, environment values, working directories, and project roots.

## Breaking changes

- None intended.
- Existing tool IDs remain stable.
- Existing invocation argument templates, risk levels, input locks, approval behavior, and Windows wrapping remain represented in compatibility tests.

## Ideas discovered during implementation

- Generate agent prompt tool documentation directly from the registry.
- Add policy profiles that approve specific low-risk tool IDs and exact argument shapes.
- Add a structured execution-result schema and output redaction layer before expanding browser-facing results.
- Add runtime health checks and platform availability reporting per tool.
- Generate manifest, resolver, tests, docs, and knowledge records together through a Tool SDK.
- Add category-specific catalog modules once built-in tool volume justifies decomposition.
- Add manifest-to-documentation consistency checks to prevent stale examples.

## Validation status

Pending evidence from the latest GitHub Actions run:

- TypeScript strict typecheck.
- Unit tests, including manifest, catalog, registry, knowledge, and bridge security tests.
- Integration tests, including authenticated tool discovery.
- Build and CLI smoke tests.
- Skill catalog and browser extension verification.
- Linux and Windows runners.

Do not mark the implementation validated until both platform jobs succeed.

## Implementation log

- 2026-08-02: Created working branch from `main`.
- 2026-08-02: Audited package scripts, tool registry, protocol schema, operation planner/executor, bridge server, browser extension manifest/background bridge, recent commits, and Skill Library manifest/loader/registry patterns.
- 2026-08-02: Selected an incremental manifest-driven refactor that preserves the current execution API.
- 2026-08-02: Created the authoritative tool roadmap, design specification, and implementation plan.
- 2026-08-02: Added strict manifest validation and trusted built-in tool interfaces.
- 2026-08-02: Replaced duplicated switch metadata with an immutable manifest-driven catalog while retaining the compatibility facade.
- 2026-08-02: Added four bounded Git read tools and injection failure tests.
- 2026-08-02: Added Knowledge Engine metadata export and authenticated bridge discovery.
- 2026-08-02: Added permanent documentation and wired all new tests into repository verification.
- 2026-08-02: Opened draft pull request #18 and queued Linux/Windows verification.
