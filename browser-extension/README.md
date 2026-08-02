# OpenBrowser Workspace Companion

This package adds local developer-workspace capabilities around the existing OpenBrowser bridge without replacing its browser sessions, operation approvals, project memory, or safety model.

The package is installed directly inside the browser extension root beside `manifest.json`. The companion runs separately on `127.0.0.1:5010` by default. The main OpenBrowser bridge remains authoritative on `127.0.0.1:5000`.

## Capabilities

- Persistent SQLite project registry and file index
- SHA-256 file indexing with WebSocket progress events
- Bounded context previews with binary, size, symlink, and path-containment checks
- Safe ripgrep search using argument-array process execution
- Python AST analysis with source-located security and quality findings
- Staged-file analysis for Git hooks
- In-process ZIP creation without shelling out to 7-Zip
- Authenticated proxy routes for OpenBrowser prompts and project memory
- PowerShell management and dashboard scripts
- GitHub CLI extension commands
- VS Code tasks and prompt/skill snippets
- Opt-in pre-commit enforcement

## Requirements

- Node.js 22 or newer
- pnpm 11.2.2
- Python 3.10 or newer
- ripgrep for `/project/search`
- PowerShell 7 for the supplied Windows scripts
- `curl` and `jq` for the GitHub CLI extension and hook
- The main OpenBrowser bridge when using prompt or memory proxy routes

## Setup

```bash
cd browser-extension
cp .env.example .env
```

Create a random `WORKSPACE_TOKEN` with at least 24 characters and copy the existing OpenBrowser control token into `BRIDGE_TOKEN`.

Example on Linux or macOS:

```bash
printf 'WORKSPACE_TOKEN=%s\n' "$(openssl rand -hex 32)" >> .env
```

Example in PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$token = [Convert]::ToHexString($bytes).ToLowerInvariant()
Add-Content .env "WORKSPACE_TOKEN=$token"
```

Install and initialize:

```bash
pnpm install --no-frozen-lockfile
pnpm run db:init
pnpm run verify
```

## Start the companion

### Directly

```bash
pnpm run dev
```

### PowerShell manager

```powershell
./openbrowser.ps1 start
./openbrowser.ps1 status
./openbrowser.ps1 stop
```

The manager tracks only the PID it started. It never terminates an unrelated process merely because that process owns the configured port.

## Register and operate on a project

PowerShell:

```powershell
./openbrowser.ps1 register -ProjectPath C:\code\my-project
./openbrowser.ps1 index
./openbrowser.ps1 search 'authentication'
./openbrowser.ps1 analyze
```

HTTP:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $WORKSPACE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"root\":\"$(pwd -P)\"}" \
  http://127.0.0.1:5010/projects/register-current
```

## Dashboard

```powershell
./dashboard.ps1
./dashboard.ps1 -Watch -IntervalSeconds 5
```

## GitHub CLI extension

The file is named `gh-openbrowser` so GitHub CLI recognizes it as `gh openbrowser` when it is executable and available on `PATH`.

```bash
chmod +x gh-openbrowser
mkdir -p "$HOME/.local/bin"
ln -sf "$(pwd)/gh-openbrowser" "$HOME/.local/bin/gh-openbrowser"
export PATH="$HOME/.local/bin:$PATH"
```

Commands:

```bash
gh openbrowser status
gh openbrowser register
gh openbrowser review
gh openbrowser analyze-pr 123
```

`review` uses the staged diff first and falls back to the unstaged diff. `analyze-pr` retrieves the diff through the authenticated GitHub CLI.

## Pre-commit hook

Install through PowerShell:

```powershell
./openbrowser.ps1 install-hook -ProjectPath C:\code\my-project
```

Manual installation:

```bash
cp hooks/pre-commit /path/to/project/.git/hooks/pre-commit
chmod +x /path/to/project/.git/hooks/pre-commit
```

Default behavior is advisory. To block a commit when high-severity findings are reported—or when analysis cannot run—set:

```bash
export OPENBROWSER_HOOK_BLOCK=1
```

## VS Code

Open `browser-extension` as the workspace folder, then run tasks from **Tasks: Run Task**.

Available tasks include installation, start/stop, project registration, indexing, project analysis, current-file analysis, and clipboard prompt submission.

## HTTP routes

| Route | Purpose | Authentication |
|---|---|---|
| `GET /health` | Companion, database, bridge URL, and active-project health | Public loopback |
| `GET /projects` | List local companion projects | Workspace token |
| `POST /projects/register-current` | Register a canonical project root | Workspace token |
| `POST /projects/active` | Select the active local project | Workspace token |
| `POST /project/context/preview` | Build a bounded file metadata preview | Workspace token |
| `POST /project/search` | Search with ripgrep | Workspace token |
| `POST /project/index` | Hash and index project files | Workspace token |
| `POST /project/analyze` | Analyze all Python files | Workspace token |
| `POST /project/analyze-file` | Analyze one Python file | Workspace token |
| `POST /project/analyze-staged` | Analyze supported staged files | Workspace token |
| `POST /export/zip` | Create an in-memory ZIP from supplied files | Workspace token |
| `POST /prompt` | Submit a prompt to the main OpenBrowser bridge | Workspace + bridge token |
| `POST /code/review` | Request grounded diff review | Workspace + bridge token |
| `POST /pr/analyze` | Request grounded pull-request analysis | Workspace + bridge token |
| `/project/memory/*` | Proxy main-bridge project memory routes | Workspace + bridge token |
| `WS /events` | Receive indexing and analysis progress | Workspace token |

WebSocket clients may send the workspace token through the `Authorization` header. The query-string fallback exists for clients that cannot set upgrade headers; avoid it when the client supports headers.

## Security model

- Loopback-only host validation
- Constant-time token comparison
- No wildcard CORS
- No arbitrary shell execution
- No interpolated shell commands
- Canonical project roots and path containment
- Rejection of absolute paths, traversal, symlinks, and duplicate ZIP paths
- 50 MB request and export limits
- Bounded child-process output and timeouts
- SQLite foreign keys, uniqueness constraints, transactions, and WAL mode
- No duplicate browser claim or response implementation

## Important boundaries

The companion project registry is auxiliary. The main bridge is still started in a specific project context, so memory and prompt proxy routes operate on the project known to that bridge process. Register the same project in both processes when using those proxy routes.

The AST analyzer currently provides deep analysis for Python. JavaScript and TypeScript staged analysis applies a small evidence-based risk ruleset; it is not a full language parser.

The extension intentionally has its own pnpm workspace boundary inside `browser-extension/`. It does not alter the root OpenBrowser lockfile or dependency graph.
