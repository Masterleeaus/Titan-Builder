# OpenBrowser Safe Coding Pass 1

## Added

- Structured `RUN_TOOL` registry using argument-vector process spawning with `shell: false`.
- Safe Git status, diff, log, branch, npm/pnpm verification, Node version, and VS Code tools.
- Package installation tools classified as `WRITE` operations.
- Legacy `RUN_COMMAND` blocked unless `OPENBROWSER_ALLOW_UNSAFE_COMMANDS=1`.
- `openbrowser status` for branch, remote, package manager, and working-tree state.
- Risk summaries and separate approval for destructive operations.
- Browser popup settings for local port, bearer token, preferred provider, and Superpower compatibility.
- Chrome/Firefox-extension-only CORS origin policy; ordinary websites are rejected.
- Token authentication across every non-health bridge endpoint when configured.
- Preferred-provider routing and filtering of Superpower-injected composer/send controls.
- User-level configuration loading from `~/.openbrowser/.env`, without reading target-project secrets.
- Removed the unused `dotenv-safe` package and invalid self-referencing `openbrowser: link:` dependency.

## Upgrade setup

1. Copy `.env.example` to `~/.openbrowser/.env`.
2. Set a strong `BRIDGE_TOKEN` and keep `OPENBROWSER_ALLOW_UNSAFE_COMMANDS=0`.
3. Build and link the CLI.
4. Reload the unpacked extension.
5. Open the extension popup and enter the same port/token.
6. Keep Superpower compatibility enabled when using Superpower for ChatGPT.

## Safe tool format

```json
{
  "action": "RUN_TOOL",
  "tool": "npm.run",
  "args": ["test:unit"]
}
```

No shell interpolation is used for `RUN_TOOL`; executables receive validated argument arrays directly.

## Deferred to later passes

- Automatic verify-and-fix loops.
- Multi-worktree concurrent bridge ports.
- Structured Git commit/push/PR tools.
- Provider selection as a per-command CLI option.


## Verification completed in this pass

- 16 focused Node tests pass.
- All changed browser-extension JavaScript files pass `node --check`.
- All changed TypeScript files pass Node 22 strip-types syntax checks.
- Full `pnpm build` and Vitest execution require dependency installation and were not available in the offline build environment used for this pass.


## Installation verification still required

On a network-connected Windows machine, run:

```powershell
corepack enable
corepack prepare pnpm@11.0.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Then load `browser-extension/` through `chrome://extensions`, enter the same bridge port and token used in `~/.openbrowser/.env`, and exercise one `ask`, one `agent`, and one `status` command.
