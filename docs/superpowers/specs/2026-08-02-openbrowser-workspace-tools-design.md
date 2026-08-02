# OpenBrowser Workspace Tools Design

## Status

Corrected after repository review: the feature belongs directly inside `browser-extension/`, which is the existing extension root containing `manifest.json`, the service worker, content scripts, popup, and side panel.

## Goal

Extend the existing OpenBrowser browser extension with persistent project indexing, Python analysis, secure code search, ZIP export, Windows management scripts, VS Code tasks, GitHub CLI helpers, and opt-in pre-commit analysis without duplicating or weakening the existing Fastify bridge.

## Architecture

The feature lives directly inside `browser-extension/` as the extension's local tooling package. The existing browser-extension runtime remains intact. The added companion Fastify service runs on port `5010` by default and communicates with the existing authenticated OpenBrowser bridge on port `5000` through explicit bearer-token configuration. It owns only auxiliary SQLite data—file indexes, analysis results, and local workspace metadata—and does not replace project memory, browser job claiming, operation approval, or session lifecycle already implemented by the main bridge.

The package files, server, database schema, tests, scripts, hooks, and VS Code configuration sit beside `browser-extension/manifest.json`. No parallel `tools/openbrowser-workspace/` application is retained.

## Security boundaries

- Bind companion HTTP and WebSocket services to `127.0.0.1` by default.
- Require `WORKSPACE_TOKEN` for all non-health routes.
- Never enable wildcard browser CORS.
- Use `spawn`/`execFile` with argument arrays; never interpolate user input into shell commands.
- Canonicalize and contain all requested paths within the active project root.
- Reject symlinks, path traversal, absolute paths, duplicate export names, and oversized request bodies.
- Use the existing bridge token when calling main-bridge endpoints.
- Do not implement dummy browser claim/response routes.
- Pre-commit analysis is opt-in, reports failures clearly, and only blocks commits when `OPENBROWSER_HOOK_BLOCK=1`.
- Preserve the existing extension manifest, provider routing, service worker, content scripts, popup, and side-panel behavior.

## Components

### Browser extension integration

`browser-extension/manifest.json` remains the extension entry point. Existing source files under `browser-extension/src/` continue to own browser behavior. The workspace additions extend that extension folder rather than creating a separate top-level product.

### Companion service

`browser-extension/bridge-server.ts` provides authenticated health and WebSocket status updates, project registration and active-project selection, SQLite file indexing with SHA-256 hashes, bounded context preview, safe ripgrep-backed code search, Python AST analysis, staged-file analysis, safe ZIP export, and proxy helpers for prompt submission and bridge-backed project memory.

### Database

`browser-extension/schema.sql` defines projects, workspace settings, job history, file index, and code-analysis tables with uniqueness and foreign-key constraints. `browser-extension/seed-db.ts` creates a deterministic demonstration project only when explicitly invoked.

### Local tooling

- `browser-extension/openbrowser.ps1`: start, stop, status, register, search, analyze, and install-hook commands without killing unrelated processes.
- `browser-extension/dashboard.ps1`: non-destructive status and system metrics.
- `browser-extension/gh-openbrowser`: GitHub CLI extension supporting register, review, and PR analysis through implemented companion endpoints.
- `browser-extension/.vscode/tasks.json`: cross-platform tasks invoking package scripts or PowerShell where required.
- `browser-extension/.vscode/code-snippets.code-snippets`: prompt and skill snippets.
- `browser-extension/hooks/pre-commit`: installable hook template rather than a committed `.git/hooks` file.

## Data flow

1. The extension remains loaded from `browser-extension/manifest.json`.
2. A user starts the companion service from the same extension directory.
3. A user registers a canonical project path.
4. The companion stores project metadata and selects it as active.
5. Search, indexing, context, and analysis routes resolve paths beneath that root.
6. Long-running operations broadcast progress to authenticated WebSocket clients.
7. Bridge-backed actions forward requests to the main bridge with its control token.
8. Local tooling calls the companion using `WORKSPACE_TOKEN`.

## Error handling

All route inputs are validated with Zod. Expected validation and containment failures return 400/403 responses. Missing tools return 503 with actionable messages. Child-process output is bounded. Temporary exports are removed in `finally` blocks. Database writes use transactions.

## Testing

- Unit tests for path containment, command argument construction, authentication, and export-name validation.
- Fastify injection tests for health, auth, registration, search validation, and bridge proxy behavior.
- Python analyzer fixture tests.
- Extension integrity checks against the existing manifest and browser runtime.
- GitHub Actions installs dependencies from `browser-extension/`, runs Linux and Windows tests/typecheck/build, parses PowerShell and Bash entrypoints, and then runs the repository-wide verification pipeline.
