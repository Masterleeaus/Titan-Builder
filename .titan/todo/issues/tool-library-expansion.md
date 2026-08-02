# Tool Library Expansion

Status: In progress
Branch: `feature/tool-library-expansion`
Started: 2026-08-02

## Existing tools discovered

The authoritative execution path is `RUN_TOOL` through `src/protocol/index.ts`, `src/operations/index.ts`, and `src/tools/registry.ts`.

Current approved tools:

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

## Missing tools

Initial gaps confirmed during audit:

- No reusable manifest/specification model for tools.
- No tool catalog/listing API for agents, the browser workspace, documentation, or knowledge capture.
- No aliases, compatibility metadata, lifecycle status, ownership, examples, or version metadata.
- No dependency/capability declarations at tool level.
- Git read tooling lacks root discovery, branch listing, remote listing, and constrained object inspection.
- Tool metadata is duplicated across the `ToolId` union, switch statement, supported-ID array, risk logic, and input-file logic.
- No machine-readable Knowledge Engine export for tools.
- No installable external-tool package loader yet.

## Architecture observations

- `src/tools/registry.ts` is the correct authoritative integration point and must remain backward compatible.
- `src/operations/index.ts` already owns planning and execution; new tools must resolve to the existing `ToolInvocation` shape rather than bypassing it.
- `src/protocol/index.ts` deliberately accepts a bounded string tool ID and delegates authorization to the registry.
- `src/server/index.ts` is the bridge API boundary and is the correct place to expose read-only tool catalog data.
- The manifest-driven Skill Library under `src/skills/` is the strongest existing pattern for versioned reusable components.
- `browser-extension/src/background.js` already proxies authenticated bridge requests; tool discovery can use that bridge without new host permissions.

## Integration risks

- A registry refactor can silently change command arguments, Windows `.cmd` wrapping, risk levels, or approval behavior.
- Runtime-loaded executable definitions would be unsafe unless their resolver implementation is trusted and package containment is enforced.
- Git revision arguments can become option-injection vectors unless `--` separators and strict ref validation are used.
- Tool listing must not disclose local absolute paths, secrets, environment values, or executable resolution details.
- Browser UI integration must remain read-only until explicit tool invocation approvals are designed.

## Dependency changes

- No new runtime dependency is planned for the foundation pass.
- Existing `zod`, Node.js 22 APIs, and current test runners are sufficient.

## Technical debt

- The product and package still retain the upstream OpenBrowser identity in several locations.
- Tool execution and tool metadata currently live in one large file.
- The required SQLite Knowledge Engine is not yet visible as an authoritative runtime service in the audited path; this pass will export normalized metadata without inventing a second database layer.
- Documentation Engine, Writer Studio, Conversation Engine, and Feature Evolution Engine are not represented as direct injectable services in the current tool path; integration must initially occur through metadata, prompts/context, and the existing operation runtime.

## Security observations

- Preserve `shell: false` for every tool.
- Reject control characters, excessive argument length, absolute paths, path traversal, and Git option injection.
- High-side-effect tools must continue to require explicit approval.
- Tool manifests must be strict, versioned, deterministic, and immutable after registration.
- Catalog endpoints must expose public metadata only.

## Breaking changes

- None permitted in the foundation pass.
- Existing tool IDs and invocation outputs remain compatible.

## Ideas discovered during implementation

- Add a signed/allow-listed external tool package loader after the built-in manifest foundation is stable.
- Generate agent prompt tool documentation from the same registry used for execution.
- Add policy profiles that can approve specific low-risk tools by tool ID and argument shape.
- Add an execution-result schema and redaction layer before exposing tool output to browser agents.
- Add tool health checks and platform availability reporting.
- Add a Tool SDK generator that creates manifest, resolver, tests, docs, and knowledge metadata together.

## Implementation log

- 2026-08-02: Created working branch from `main`.
- 2026-08-02: Audited package scripts, tool registry, protocol schema, operation planner/executor, bridge server, browser extension manifest/background bridge, recent commits, and Skill Library manifest/loader/registry patterns.
- 2026-08-02: Selected an incremental manifest-driven refactor that preserves the current execution API.
