# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 0.4.x   | :white_check_mark: |
| 0.3.x   | :white_check_mark: |
| 0.2.x   | :x:                |
| 0.1.x   | :x:                |

## Reporting a vulnerability

If you discover a security vulnerability in OpenBrowser, please report it responsibly.

**Do not** open a public GitHub issue for security bugs.

Instead, email the maintainer with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact (e.g. local file access, token exposure, remote code execution)
- Your environment (OS, Node version, browser)

**Contact:** Open a [GitHub Security Advisory](https://github.com/1129Aliasgar/OpenBrowser/security/advisories/new) (preferred) or email the repository owner via their GitHub profile.

You should receive a response within **7 days**. We will work with you to understand and address the issue before any public disclosure.

## Scope

OpenBrowser is a **local-first** tool. The bridge server binds to `127.0.0.1` by default and is intended for development on your own machine.

In scope for security reports:

- Unauthorized file system access outside the project root
- Bridge API bypass when `BRIDGE_TOKEN` is configured
- Untrusted webpage access to browser bridge routes
- Bypass of the structured safe-tool registry
- Extension privilege escalation or cross-site data leakage
- Path traversal in agent operations
- Sensitive data written to logs or history files unintentionally

Out of scope (by design):

- Prompt injection against third-party AI services (ChatGPT, Gemini, etc.)
- Abuse of browser AI terms of service
- Issues that require physical access to an unlocked machine with OpenBrowser already running

## Recommended practices for users

- Run the bridge server only on `localhost`.
- Set a strong random `BRIDGE_TOKEN` in `~/.openbrowser/.env`, then enter the same token in the extension popup.
- Keep the bridge bound to `127.0.0.1`; never expose it on `0.0.0.0`.
- Never commit `.env` or share your `BRIDGE_TOKEN`.
- Review agent-mode diffs and risk labels before applying. Destructive operations receive an additional prompt.
- Keep `OPENBROWSER_ALLOW_UNSAFE_COMMANDS=0`; use structured `RUN_TOOL` operations instead.
- Keep the Chrome extension updated from a trusted source (this repository).

## Disclosure policy

We aim to:

1. Confirm the report and assign severity.
2. Develop and test a fix.
3. Release a patched version or document mitigations.
4. Credit reporters in the release notes (unless you prefer to remain anonymous).

Thank you for helping keep OpenBrowser and its users safe.

## Coding side-panel security

The v0.4.0 side panel is intentionally limited to OpenBrowser's existing supported AI host permissions. It does not request `<all_urls>`, Chrome Debugger, `webRequest`, `declarativeNetRequest`, or downloads permissions.

Prompt delivery is coordinated through the extension background worker and existing provider content scripts. A prompt request must contain plain text, is limited to 100,000 characters, and can only be delivered to an already-open supported provider tab. The side panel cannot execute page JavaScript or local shell commands.

Custom prompts are stored in `chrome.storage.local`. Export requires an explicit user action. Imported JSON is normalized and prompts missing a title or content are rejected.


## ChatGPT scans, exports, and auto-continue

- Apps/Plugins, Library, and conversation scans run only after a visible user action.
- Scan results are limited to the visible ChatGPT DOM and cached locally. OpenBrowser does not claim access to a complete account inventory.
- File downloads are restricted to HTTPS ChatGPT/OpenAI and `*.oaiusercontent.com` hosts.
- Each exported file is limited to 15 MB. Inaccessible files fall back to Markdown metadata.
- ZIP filenames are sanitized and paths are constructed by OpenBrowser rather than trusted from page content.
- Auto-continue is disabled by default, capped at ten, and excluded from agent operation responses.
- Fallback continuation requires explicit opt-in and a response that appears truncated.

## Recoverable browser-job leases

Browser jobs are not trusted merely because an extension tab received the initial event. Each job must be claimed from the loopback bridge and receives a short-lived random claim token. The active content script renews that lease while it is waiting for the AI response.

Partial chunks, failures, and final responses must include the current claim token. Expired or replaced tokens are rejected, preventing a stale tab from completing a job after another tab has recovered it. When a claim expires, the server returns the job to the pending queue so the extension can rediscover it after a service-worker or tab interruption.

The claim token is separate from `BRIDGE_TOKEN`: `BRIDGE_TOKEN` authenticates the extension or CLI to the local bridge, while the claim token establishes temporary ownership of one queued job.
