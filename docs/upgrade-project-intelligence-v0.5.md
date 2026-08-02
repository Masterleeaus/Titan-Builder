# OpenBrowser v0.5.0 — Project Intelligence Port

This pass ports the most useful project-context concepts from AI Coding Studio into OpenBrowser without copying its larger unfinished runtime.

## Added

- Persistent named project registry stored at `~/.openbrowser/projects.json`.
- Automatic registration of the current project for `ask` and `agent` sessions.
- Explicit per-project memory stored at `.openbrowser/memory.json`.
- Project memory is visibly injected into both ask and agent prompts.
- Budgeted file and folder context with deterministic priority ordering.
- Sensitive path exclusion for `.env`, credentials, private keys, SSH/GPG material, package registry credentials, and service-account files.
- Context preview and Markdown export commands.
- Projects and Memory side-panel tabs.
- Authenticated bridge endpoints for project inventory, memory CRUD, and context previews.

## CLI

```powershell
openbrowser project add . --name "AI Coding Studio"
openbrowser project list
openbrowser project use "AI Coding Studio"

openbrowser memory add "Preserve Chrome and Firefox compatibility." --tag compatibility browser
openbrowser memory list

openbrowser context preview src tests docs --budget 60000
openbrowser context export openbrowser-context.md src tests --budget 60000

openbrowser ask "Review the runtime" --context src/core tests --budget 50000
openbrowser agent "Repair the bridge" --context src/server src/client --budget 70000 --verify standard
```

## Context priority

OpenBrowser prioritises root manifests and configuration, explicitly selected paths, runtime entry points, tests, documentation, then supporting files. Selection is deterministic and bounded by total characters, per-file characters, and maximum file count.

## Security

Context collection remains inside the current project root. Sensitive files and binary assets are excluded before content is read. The side panel receives only context metadata during preview, never raw local file contents.

Selecting an active project in the side panel updates project metadata; local execution still occurs only in the directory where the OpenBrowser CLI/server was started.
