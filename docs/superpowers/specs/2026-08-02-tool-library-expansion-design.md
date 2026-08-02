# Titan Builder Tool Library Expansion Design

## Decision

Extend the existing `RUN_TOOL` architecture with a strict, manifest-driven built-in tool catalog. Preserve `resolveToolInvocation`, `ToolInvocation`, existing tool IDs, command arguments, risk classifications, approval behavior, operation planning, and transaction execution.

This is an incremental foundation pass, not a parallel runtime.

## Goals

- Make every built-in tool self-describing, versioned, discoverable, testable, and suitable for Knowledge Engine indexing.
- Remove duplicated tool metadata from the current static union/switch registry.
- Add four missing, bounded Git read tools: `git.root`, `git.branch.list`, `git.remote.list`, and `git.show`.
- Expose safe tool catalog metadata through the authenticated bridge for agents and the browser workspace.
- Preserve all current security and compatibility guarantees.

## Non-goals

- Loading untrusted executable code from arbitrary packages.
- Adding a second operation executor.
- Directly implementing SQLite, GitHub, browser automation, memory, conversation, or documentation services that do not yet have authoritative injectable runtime interfaces.
- Allowing browser clients to invoke tools without the existing preview and approval flow.

## Architecture

### Tool manifest

`src/tools/manifest.ts` defines a strict Zod schema for public tool metadata:

- schema version
- canonical ID and aliases
- name, purpose, category, responsibilities
- semantic version and lifecycle status
- inputs and outputs as JSON object schemas
- permissions/capabilities
- dependencies and services used
- commands and configuration
- security, failure handling, validation, tests, documentation, and examples
- compatibility
- risk and approval mode
- knowledge metadata relationships

The schema excludes executable paths and resolver functions. Those remain trusted code.

### Trusted built-in definition

`src/tools/types.ts` defines `BuiltinToolDefinition`, which combines a validated manifest with a trusted resolver function and optional input-file resolver. The executable implementation is code-reviewed and bundled with Titan Builder.

### Immutable catalog

`src/tools/catalog.ts` owns the built-in definitions and registration rules. It validates manifests, detects ID/alias collisions, returns deterministic sorted listings, resolves aliases, and freezes registered definitions.

### Compatibility registry

`src/tools/registry.ts` remains the compatibility entry point. It delegates to the catalog while preserving current exports and behavior:

- `ToolId`
- `ToolRisk`
- `ToolInvocation`
- `resolveToolInvocation()`
- `requiresExplicitApproval()`
- `toolInputFiles()`
- `isUnsafeLegacyCommandEnabled()`

Existing consumers do not move.

### Knowledge export

`src/tools/knowledge.ts` converts public manifests into deterministic, database-agnostic records suitable for the future SQLite Knowledge Engine. It does not create a competing storage system.

### Bridge integration

`src/server/index.ts` adds `GET /tools`, returning public manifest metadata and knowledge records. It uses existing bridge authentication/origin policy. It never returns executable paths, environment values, local absolute paths, or resolver internals.

The browser extension can consume this endpoint through its existing `BRIDGE_REQUEST` proxy; no host permission or new browser execution path is required in this pass.

## New Git tools

### `git.root`

Command: `git rev-parse --show-toplevel`

- No arguments.
- Risk: `READ`.
- Purpose: repository/workspace discovery.

### `git.branch.list`

Commands:

- no args: `git branch --format=%(refname:short)`
- `--all`: `git branch --all --format=%(refname:short)`

- Reject every other argument.
- Risk: `READ`.

### `git.remote.list`

Command: `git remote`

- No arguments.
- Deliberately does not use `-v`, preventing credential-bearing remote URLs from entering agent output.
- Risk: `READ`.

### `git.show`

Command: `git show --no-ext-diff --stat --oneline --decorate --no-renames <revision> --`

- Exactly one revision argument.
- Revision length capped by existing argument validation.
- Strict revision grammar: alphanumeric SHA/ref characters plus `.`, `_`, `/`, and `-`; must not begin with `-`; no `..`, `@{`, `~`, `^`, colon, whitespace, backslash, or control characters.
- `--` terminates revision/path parsing.
- Risk: `READ`.

## Data flow

1. Agent response is validated by `src/protocol/index.ts`.
2. `src/operations/index.ts` receives `RUN_TOOL`.
3. Registry resolves the ID/alias through the immutable catalog.
4. Trusted resolver validates arguments and returns `ToolInvocation` with `shell: false`.
5. Operation planner locks required input files and records risk/preconditions.
6. Existing approval and transactional execution paths apply unchanged.
7. Public catalog metadata is independently available to agents and UI through `GET /tools`.

## Error handling

- Manifest errors fail registration with field-specific messages.
- Duplicate IDs or aliases fail catalog creation.
- Unsupported IDs fail before process execution.
- Invalid argument count, enum values, script names, paths, or revisions fail deterministically.
- Missing required input files fail during operation planning.
- Process and transaction failures continue through existing rollback/history behavior.

## Security model

- Tool resolvers are trusted bundled code; manifests alone cannot introduce execution.
- Every command uses a fixed executable and fixed argument template.
- User values occupy validated argument positions only.
- `shell` remains `false`.
- High-side-effect tools retain explicit approval.
- Public metadata is separated from private execution implementation.
- Catalog objects and returned lists are immutable.

## Testing

- Manifest validation tests: valid contract, malformed IDs/versions/schemas, unsafe approval/risk combinations, duplicate fields, invalid compatibility, missing documentation/security/test data.
- Catalog tests: deterministic ordering, canonical and alias resolution, duplicate collision rejection, immutability.
- Registry compatibility tests: all existing command shapes and risks remain unchanged.
- New Git tests: success, argument count, enum rejection, revision injection, and platform behavior.
- Knowledge export tests: deterministic normalized records and relationship fields.
- Server integration test: authenticated `GET /tools`, no private implementation details, unauthorized request rejection.
- Full repository verification remains `pnpm run verify` on Linux and Windows CI.

## Compatibility

- Node.js `>=22`.
- TypeScript ESM.
- No new dependencies.
- Existing `RUN_TOOL` protocol remains compatible.
- Existing browser extension permissions remain unchanged.
- Existing tool IDs remain stable.

## Future extension boundary

A later external package loader may discover contained `manifest.json` files using the Skill Library loader pattern. Executable entrypoints must not be enabled until Titan Builder has an explicit trust policy, signature/allow-list model, compatibility checks, and sandbox/permission enforcement.
