# OB-008 — Bridge Authentication, Origin, and Approval Boundary

- Severity: High
- Branch: `agent/fix-titan-builder-v2.6-deep-scan`
- Status: FIXED — dependency-backed verification pending
- Source commit: `bb896fe49928ac05b01aaff24c853104fa1f3ca7`
- Artifact SHA-256: `f2c41d5dca6dc748759f198a8fe1c445c5e86f717015c3241c8b60f952b63c0d`
- Offline applicator run: `30724766381`
- Offline applicator job: `91434285981`

## Confirmed defects

1. Bridge authentication disappeared entirely when `BRIDGE_TOKEN` was absent.
2. One bearer token covered browser lifecycle, session control, project data, and file-operation endpoints.
3. Every `chrome-extension://` and `moz-extension://` origin was accepted rather than an exact configured or paired extension origin.
4. `POST /operations/apply` accepted raw operation arrays without proof that the server-side preview was approved.
5. The extension popup described its bridge token as optional, and installation did not reliably provision separate strong credentials.

## Red evidence

Failure-first tests required behavior absent from the original implementation:

- Mandatory distinct strong control and browser credentials.
- Route scopes separating browser lifecycle from privileged control endpoints.
- Exact configured extension origins or first-use authenticated origin pinning.
- Rejection of normal web origins and secondary extension origins.
- One-time, short-lived operation capabilities bound to the exact project and approved preview.
- Raw-operation apply rejection and approval replay rejection.
- Secure credential generation and persistence when setup starts without tokens.

## Implemented repair

### Authentication and route scopes

- Generates distinct cryptographically strong `BRIDGE_TOKEN` and `BRIDGE_BROWSER_TOKEN` values when missing.
- Persists credentials in the OpenBrowser user environment file with restrictive POSIX permissions.
- Rejects weak configured tokens and identical control/browser tokens.
- Fails closed by default; the only missing-token bypass is explicit `OPENBROWSER_INSECURE_DEV=1`.
- Classifies routes as public, browser, shared, or control.
- Browser credentials cannot invoke session-control or operation endpoints.
- Control credentials are not accepted from extension-page origins.

### Origin policy

- Normal website origins are always rejected.
- `BRIDGE_EXTENSION_ORIGINS` supports an exact comma-separated allowlist.
- Without an allowlist, the first correctly authenticated extension origin is pinned for the server lifetime.
- A different extension origin is rejected after pinning.
- CORS preflight follows the same exact/pinned origin policy.

### Operation approval capability

- `/operations/preview` issues a random short-lived approval capability bound to:
  - canonical project root,
  - exact cloned server-side plans,
  - stable preview hash,
  - risk summary,
  - expiry time.
- Raw capability values are stored only as SHA-256 hashes.
- `/operations/apply` accepts only the capability token, not a replacement operation array.
- Capabilities are one-time and reject expiry, replay, project mismatch, or preview mismatch.
- The approval store is bounded to prevent unbounded outstanding capabilities.

### Client and setup

- CLI bridge requests refuse to run with a missing or weak control token.
- Extension requests send only a strong browser token.
- Popup labels and validation now require `BRIDGE_BROWSER_TOKEN` with a minimum 32-character value.
- Windows setup generates missing control and browser credentials separately and instructs the user to copy only the browser token into the extension.
- `.env.example` and README document the secure defaults and explicit development-only escape hatch.

## Current verification

The guarded applicator passed:

- Artifact checksum and exact 18-path allowlist.
- 127/127 dependency-free Node tests.
- TypeScript and JavaScript parse checks for every changed source file.
- Manifest V3 extension integrity.
- Commit and push to the repair branch.

Do not mark this issue VERIFIED until the full GitHub pipeline passes typecheck, all Node tests, bridge/operation integrations, production build, CLI smoke, and extension integrity on this source commit or a direct descendant.
