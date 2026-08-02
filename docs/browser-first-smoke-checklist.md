# Browser-First Chrome Smoke Checklist

Use this checklist after installing or updating Titan Builder. It validates the real Windows service, unpacked Chrome extension, authenticated AI-provider tab, Work view, two-stage approval, file application, verification, stale-preview handling, restart recovery, cancellation, and credential separation.

## Safety boundary

Run Agent tests only against a disposable fixture project. Never use a production repository for the first workstation smoke test.

The Chrome extension must contain only `BRIDGE_BROWSER_TOKEN`. Never copy `BRIDGE_TOKEN` into Chrome.

## 1. Create and register a disposable fixture project

Open PowerShell:

```powershell
$Fixture = Join-Path $HOME 'OpenBrowser-Smoke-Fixture'
New-Item -ItemType Directory -Force -Path $Fixture | Out-Null
Set-Location $Fixture
@'
{
  "name": "openbrowser-smoke-fixture",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
'@ | Set-Content -Encoding UTF8 package.json
@'
import test from 'node:test';
import assert from 'node:assert/strict';

test('fixture works', () => {
  assert.equal(1 + 1, 2);
});
'@ | Set-Content -Encoding UTF8 fixture.test.mjs
openbrowser project add . --name "OpenBrowser Smoke Fixture"
```

**Expected result:** the CLI reports a registered project with an identifier beginning with `project-`.

## 2. Run local preflight diagnostics

```powershell
openbrowser doctor
openbrowser doctor --json > openbrowser-doctor.json
openbrowser service status
openbrowser project list
```

**Required result:**

- `openbrowser doctor` has no `FAIL` checks;
- Node, configuration, both token checks, token separation, secure mode, extension manifest, companion package, and project registry report `PASS`;
- `service.bridge` may report `WARN` only when the service has not yet been started;
- the JSON report contains no token values;
- the fixture project appears in `openbrowser project list`.

Start the service when needed:

```powershell
openbrowser service start
openbrowser service status
```

**Expected result:** the service reports `running`, a PID, and a log path. Re-run `openbrowser doctor`; `service.bridge` must now report `PASS`.

## 3. Load or reload the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Remove an obsolete Titan Builder/OpenBrowser unpacked extension when its path points elsewhere.
4. Select **Load unpacked** and choose the repository's `browser-extension` directory printed by the Windows installer.
5. After an update, select **Reload** on the extension card.
6. Open the extension details and record its extension ID and version.

**Expected result:** Chrome loads the Manifest V3 extension without errors and the side panel contains a **Work** tab.

## 4. Configure the restricted browser credential

Open `%USERPROFILE%\.openbrowser\.env` locally and copy only the value of:

```text
BRIDGE_BROWSER_TOKEN=...
```

In the extension settings:

- Bridge host: `127.0.0.1`
- Bridge port: `5000`, unless `PORT` uses another configured value
- Browser token: the `BRIDGE_BROWSER_TOKEN` value

Do not enter `BRIDGE_TOKEN` in any extension field.

**Expected result:** the extension's bridge status becomes healthy and project selection loads registered projects.

## 5. Prepare an authenticated provider tab

1. Open a supported provider, such as ChatGPT, Claude, Gemini, DeepSeek, Grok, Perplexity, or GLM.
2. Sign in normally.
3. Open a standard conversation page with an available composer.
4. Keep that tab open while using the extension side panel.
5. In the Work tab, select the same provider explicitly for the first test rather than relying on automatic selection.

**Expected result:** the extension identifies the provider tab and can submit an OpenBrowser job through the existing browser-session queue.

## 6. Ask-mode no-write test

In **Work**:

- Mode: `Ask`
- Project: `OpenBrowser Smoke Fixture`
- Prompt:

```text
Read this registered project and tell me the package name and how many test files it contains. Do not propose or perform file changes.
```

Submit the run.

**Required result:**

- the run progresses through model submission and completes with a text answer;
- the answer identifies `openbrowser-smoke-fixture` and the fixture test file;
- no operation review or Apply button appears;
- `package.json` and `fixture.test.mjs` remain unchanged;
- the run can be reopened after closing and reopening the side panel.

Record the run ID.

## 7. Agent preview and two-stage approval test

In **Work**:

- Mode: `Agent`
- Project: `OpenBrowser Smoke Fixture`
- Verification profile: `standard`
- Prompt:

```text
Create README.md containing a heading named OpenBrowser Smoke Fixture and one sentence saying this project validates the browser-first local agent workflow. Do not modify any other file.
```

Submit the run.

### Review stage

**Required result before approval:**

- the run stops at `awaiting_approval`;
- exactly one create-file operation is shown for `README.md`;
- the full proposed content is visible as text;
- `README.md` does not yet exist on disk;
- no operation is applied merely by selecting it.

Select the operation and choose the first approval action.

### Final confirmation stage

**Required result:**

- status changes to `ready_to_apply`;
- the UI clearly requires a second confirmation;
- the file still does not exist before final confirmation.

Choose the final Apply action.

### Apply and verification stage

**Required result:**

- `README.md` is created with exactly the reviewed content;
- status progresses through `applying` and `verifying` to `completed`;
- verification results are shown;
- the changed-path list contains only `README.md`;
- reusing the previous approval capability is rejected.

## 8. Stale-preview test

1. Start another Agent run proposing an edit to `README.md`.
2. Wait until `awaiting_approval` and review the diff.
3. Before approving, edit `README.md` manually in PowerShell or an editor.
4. Approve the previously reviewed operation.

**Required result:**

- OpenBrowser detects the changed filesystem state;
- the old approval is not accepted for execution;
- the run returns to review with a refreshed preview or a clear stale-preview error;
- no stale operation is applied;
- a new review and fresh two-stage approval are required.

## 9. Restart recovery test

1. Start an Agent run and leave it at `awaiting_approval`.
2. Run:

```powershell
openbrowser service stop
openbrowser service start
```

3. Reopen the Work tab and restore the run.

**Required result:**

- the run and reviewed operation remain visible;
- no file operation replays automatically;
- no pre-restart approval capability remains valid;
- the user must review and approve again before any write.

## 10. Cancellation test

1. Start a new Ask or Agent run.
2. Cancel it before it enters `applying` or `verifying`.

**Required result:**

- status becomes `cancelled`;
- no file is written;
- the run cannot later be approved or applied.

## 11. Credential-separation test

### Browser token against privileged route

Using a local HTTP client, attempt a control-only route with `BRIDGE_BROWSER_TOKEN`.

**Required result:** HTTP `401` or `403`; the browser token cannot access privileged operation or session-control routes.

### Control token in Chrome

Confirm the extension settings and Chrome local storage do not contain `BRIDGE_TOKEN`.

**Required result:** only the restricted browser token is present in the extension.

## 12. Capture evidence when a step fails

Record all of the following before changing configuration or restarting repeatedly:

- `openbrowser doctor --json` output;
- `openbrowser service status` output;
- recent `openbrowser service logs --lines 300` output;
- run ID;
- current run snapshot and audit-history response when available;
- Chrome extension ID and version;
- exact provider URL and provider name;
- Chrome side-panel/background/content-script console error;
- the operation status at failure;
- whether a file changed on disk;
- Windows version, Node version, Python version, and pnpm version.

Never include either bridge token in screenshots, logs, issues, or pull requests.

## 13. Pass criteria

The workstation smoke test passes only when:

- the doctor reports no failures;
- the service is healthy;
- the extension connects using only the browser token;
- Ask completes without writes;
- Agent produces a reviewable preview and writes nothing before two confirmations;
- Apply changes only the selected reviewed path;
- verification completes;
- stale previews fail closed;
- restart never replays writes or restores approval capability;
- cancellation prevents later execution;
- browser credentials cannot access privileged routes.

Delete the disposable fixture after collecting any required evidence:

```powershell
openbrowser project remove "OpenBrowser Smoke Fixture"
Remove-Item -Recurse -Force $Fixture
```
