# Tool Library Expansion

Status: Validated; pull request preparation complete
Branch: `feature/tool-library-expansion`
Pull request: #18
Started: 2026-08-02
Implementation verification: GitHub Actions run `30733643082`

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

- Strict, versioned tool manifests covering purpose, category, responsibilities, schemas, permissions, dependencies, services, commands, configuration, security, failure handling, validation, tests, documentation, examples, semantic version, lifecycle, compatibility, approval, and Knowledge Engine relationships.
- Canonical identity enforcement: every manifest ID must equal `titan.tool.<runtimeId>`.
- Trusted built-in definitions separated from public manifest metadata.
- Runtime manifest validation at registry construction, not only at definition creation.
- Immutable, deterministic catalog registration with canonical ID and alias collision protection.
- Resolver-output validation that rejects tool-ID drift, risk drift, shell execution, relative working directories, malformed executables, and invalid arguments before execution.
- Backward-compatible `src/tools/registry.ts` facade.
- Compatibility tests for all existing command templates, risks, input locks, approval behavior, and Windows command-shim behavior.
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

These remain explicit roadmap items rather than hidden partial implementations:

- Contained workspace read/search tool package.
- Authoritative SQLite read/query tools once the SQLite Knowledge Engine service interface exists.
- Provider-backed GitHub tools once an injectable GitHub runtime exists.
- Browser inspection tools with an explicit session/origin permission model.
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
- The latest installation-doctor changes on `main` were preserved during branch synchronization. `package.json` now runs both the doctor/install verification and the Tool Library verification suites.

## Integration risks

- Registry refactoring can silently change command arguments, Windows `.cmd` wrapping, risk levels, or approval behavior. Dedicated compatibility tests cover these invariants.
- Runtime-loaded executable definitions would be unsafe unless resolver trust, signature/allow-list verification, package containment, compatibility enforcement, and process isolation are implemented.
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
- The authenticated `/tools` route is registered in `browser-workflow-routes.ts` because that module is already wired into server creation. A future route decomposition may move it into a focused tool route module.
- GitHub Actions reports that some upstream actions still declare the Node 20 runtime and are being forced onto Node 24. Those actions should be upgraded before the platform removes the compatibility override.

## Security observations

- Every tool preserves `shell: false`.
- Control characters and excessive arguments are rejected centrally.
- Resolver output is checked against the registered manifest immediately before operation execution.
- Project path containment remains enforced by existing operation and workspace security services.
- `git.remote.list` returns remote names only, not credential-bearing URLs.
- `git.show` rejects option prefixes, ranges, reflogs, ancestry operators, pathspec syntax, whitespace, and backslashes.
- High-side-effect tools continue to require explicit approval.
- Tool manifests are strict, versioned, deterministic, and deeply immutable.
- Catalog objects, resolved invocation arguments, and knowledge records are immutable.
- `/tools` requires an authenticated control client or authenticated/pinned browser-extension origin.
- Discovery responses exclude executable paths, resolver functions, environment values, working directories, and project roots.

## Breaking changes

- None.
- Existing tool IDs remain stable.
- Existing invocation argument templates, risk levels, input locks, approval behavior, and Windows wrapping are preserved and covered by compatibility tests.
- The `RUN_TOOL` protocol and operation executor remain unchanged.

## Review findings resolved

- Corrected the semantic-version validator so complete versions such as `1.0.0` are accepted.
- Moved source-level Tool Library tests to the repository's existing `tsx` runner while retaining production `.js` ESM imports.
- Separated central control-character rejection from Git revision grammar assertions.
- Added registry-boundary manifest revalidation.
- Added canonical manifest-ID/runtime-ID agreement.
- Added resolver-output validation against manifest identity and risk.
- Corrected synthetic catalog fixtures to comply with canonical identity rules.
- Rebased the branch onto current `main` and reconciled concurrent installation-doctor verification changes without dropping either suite.

## Review limitations

- CodeRabbit was requested but could not be executed in the connector-only environment. The CLI was not installed, and installation failed because the execution container could not resolve `cli.coderabbit.ai`.
- A manual architecture/security review and the complete Linux/Windows CI matrix were completed instead. Do not describe this as a CodeRabbit review.

## Ideas discovered during implementation

- Generate agent prompt tool documentation directly from the registry.
- Add policy profiles that approve specific low-risk tool IDs and exact argument shapes.
- Add a structured execution-result schema and output redaction layer before expanding browser-facing results.
- Add runtime health checks and platform availability reporting per tool.
- Generate manifest, resolver, tests, docs, and knowledge records together through a Tool SDK.
- Add category-specific catalog modules once built-in tool volume justifies decomposition.
- Add manifest-to-documentation consistency checks to prevent stale examples.

## Validation evidence

GitHub Actions workflow: `Verify OpenBrowser`

Verified implementation run: `30733643082`

- Ubuntu: passed.
- Windows: passed.
- Dependency installation from lockfiles: passed.
- Strict TypeScript typecheck: passed.
- Existing Node and browser-extension tests: passed.
- Tool manifest, catalog, registry, knowledge, and invocation tests: passed.
- Authenticated `/tools` integration and bridge security tests: passed.
- Existing installation-doctor and Windows installer tests: passed.
- Integration tests: passed.
- Production build: passed.
- CLI, service, and doctor smoke tests: passed.
- Skill catalog verification: passed.
- Browser-extension companion verification: passed.

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
- 2026-08-02: Added registry-boundary and resolver-output contract enforcement during review.
- 2026-08-02: Rebased onto the latest `main` and reconciled the concurrent installation-doctor test pipeline.
- 2026-08-02: Passed complete Ubuntu and Windows verification in run `30733643082`.
