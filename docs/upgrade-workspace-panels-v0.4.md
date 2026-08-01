# OpenBrowser v0.4.0 — Workspace Panels, Auto-Continue, and Exporter

## Added

- Skills panel with six built-in coding skills and custom skill CRUD.
- Agent Profiles panel with four built-in profiles and custom profile CRUD.
- Active skills and profile injection into side-panel prompts and CLI jobs.
- ChatGPT Apps/Plugins visible-page scanner with local caching.
- ChatGPT File Library and current-conversation reply scanners.
- File exporter for one/selected/all scanned items in Markdown or ZIP.
- 15 MB per-file cap, approved-host validation, sanitized ZIP names, and metadata fallback.
- Settings panel for bridge configuration, provider routing, Superpower compatibility, and auto-continue.
- Opt-in auto-continue capped at 1–10 continuations, native-control first, fallback only for likely truncation.

## Security boundaries

The extension still does not request `<all_urls>`, `debugger`, `webRequest`, or `declarativeNetRequest`. ChatGPT inventory scans are explicit and visible-page only. File downloads are restricted to approved HTTPS ChatGPT/OpenAI file hosts. Agent-mode JSON operations are excluded from auto-continue.

## Known limitations

ChatGPT DOM and URLs can change. The Apps/Plugins and Library panels do not use an official inventory API and cannot guarantee discovery of off-screen or account-wide items. Some signed URLs may not be fetchable by an extension; those exports contain a Markdown record instead.

## Verification

Run:

```bash
pnpm run test:node
pnpm build
```

The first command covers the dependency-free safety, workspace, scanner, exporter, prompt, Git, and bridge tests. The production build requires installed dependencies.
