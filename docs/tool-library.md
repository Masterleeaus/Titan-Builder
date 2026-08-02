# Titan Builder Tool Library

Titan Builder tools are trusted executable capabilities registered through the existing `RUN_TOOL` operation path.

The Tool Library does not create a second executor. It adds strict manifests, discovery, knowledge metadata, and reusable definitions around the established operation planner, approval system, and transactional executor.

## Architecture

```text
Agent response
  -> protocol validation
  -> RUN_TOOL operation
  -> immutable tool registry
  -> trusted resolver
  -> operation preview and risk classification
  -> approval where required
  -> transactional execution
  -> history and failure reporting
```

Authoritative files:

- `src/tools/manifest.ts` — public, versioned tool specification.
- `src/tools/catalog.ts` — trusted built-in implementations and immutable registration.
- `src/tools/registry.ts` — backward-compatible execution facade.
- `src/tools/knowledge.ts` — normalized Knowledge Engine records.
- `src/operations/index.ts` — authoritative planning and execution.
- `src/server/browser-workflow-routes.ts` — authenticated tool discovery endpoint.

## Required specification

Every production tool manifest defines:

- canonical and runtime IDs
- name, purpose, category, and responsibilities
- structured input and output schemas
- permissions and dependencies
- services used and command templates
- configuration requirements
- security considerations
- failure handling
- validation and tests
- documentation and examples
- semantic version and lifecycle status
- risk and approval mode
- compatibility
- Knowledge Engine relationships

Manifest metadata never grants execution. A tool becomes executable only when a trusted bundled resolver is registered in the built-in catalog.

## Security invariants

Every tool must preserve these invariants:

1. Use a fixed executable selected by trusted code.
2. Keep `shell: false`.
3. Validate every caller-supplied argument before process creation.
4. Reject control characters and excessive argument lengths.
5. Keep project paths contained within the approved workspace.
6. Require explicit approval for network writes, arbitrary execution, destructive actions, and publishing.
7. Lock relevant input files during operation planning.
8. Expose only public manifest data through discovery APIs.
9. Never return credentials, environment secrets, local executable resolution, resolver functions, or unneeded absolute paths.
10. Preserve deterministic behavior across supported platforms.

## Built-in tools

Existing tools remain compatible:

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

The expansion adds four bounded Git read tools.

### `git.root`

Resolves the repository top-level directory.

```json
{
  "action": "RUN_TOOL",
  "tool": "git.root",
  "args": []
}
```

Command template:

```text
git rev-parse --show-toplevel
```

### `git.branch.list`

Lists local branches or all local and remote-tracking branches.

```json
{
  "action": "RUN_TOOL",
  "tool": "git.branch.list",
  "args": ["--all"]
}
```

Only `--all` is accepted. Arbitrary Git options are rejected.

### `git.remote.list`

Lists remote names without returning remote URLs.

```json
{
  "action": "RUN_TOOL",
  "tool": "git.remote.list",
  "args": []
}
```

The implementation deliberately uses `git remote`, not `git remote -v`, to avoid exposing credential-bearing URLs.

### `git.show`

Reads a summary for one constrained revision.

```json
{
  "action": "RUN_TOOL",
  "tool": "git.show",
  "args": ["HEAD"]
}
```

Revision ranges, reflog expressions, ancestry operators, pathspec syntax, option prefixes, whitespace, and backslashes are rejected. A final `--` terminates revision and path parsing.

## Tool discovery

Authenticated bridge clients may call:

```text
GET /tools
```

The response contains:

```json
{
  "schemaVersion": "1",
  "tools": [],
  "knowledge": []
}
```

The browser extension can access this endpoint through its existing authenticated `BRIDGE_REQUEST` proxy. Tool discovery does not add a browser-side execution bypass; actual execution remains subject to operation preview and approval.

## Knowledge Engine metadata

`createToolKnowledgeRecords()` converts manifests into deterministic records containing:

- summary and keywords
- category and version
- related tools, agents, skills, and workflows
- dependencies and services
- permissions, risk, and approval mode
- compatibility

The export is database-agnostic. It is suitable for insertion into the future authoritative SQLite Knowledge Engine without creating a competing storage layer.

## Adding a built-in tool

1. Search the existing catalog, services, commands, managers, adapters, and providers for duplicate functionality.
2. Add failing unit and failure tests.
3. Define one `BuiltinToolDefinition` in `src/tools/catalog.ts`.
4. Use a complete manifest; do not weaken required fields.
5. Use a fixed executable and deterministic argument template.
6. Assign the lowest accurate risk level, never a convenient one.
7. Declare input files that must be locked before execution.
8. Add documentation and usage examples.
9. Update `.titan/todo/issues/planned-tools.md` and the active implementation issue.
10. Run `pnpm run verify` and require Linux and Windows CI before marking the tool validated.

## External tool packages

Arbitrary package loading remains intentionally disabled.

Before installable third-party executable tools are supported, Titan Builder needs:

- an explicit trust and publisher model
- signature or allow-list verification
- package boundary and symlink containment
- compatibility checks
- permission enforcement
- controlled entrypoint loading
- upgrade and deprecation policy
- sandboxing or equivalent process isolation

A manifest alone must never be treated as authority to execute code.
