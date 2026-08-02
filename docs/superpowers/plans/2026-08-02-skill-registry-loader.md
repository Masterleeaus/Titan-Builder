# Skill Registry and Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development task-by-task.

**Goal:** Make canonical Titan skill packages discoverable, loadable, alias-compatible, and activatable without replacing custom skills or duplicating executable implementations.

**Architecture:** Canonical packages live under `browser-extension/skill-library/packages/`. The root TypeScript runtime validates and discovers packages from disk, then builds an immutable registry with deterministic ordering and collision checks. A deterministic generator emits an extension-safe catalog from the same packages. The existing workspace prompt surface consumes guidance entries from that catalog while resolving legacy IDs through aliases.

**Tech Stack:** TypeScript, Node 22, `node:test`, Zod, fast-glob, browser ES modules.

## Global Constraints

- Work only on `feature/skill-library-pass-02`.
- Do not merge or modify `main`.
- Keep the root runtime authoritative for executable handlers.
- Keep custom browser skills and profiles backward compatible.
- Treat manifest and instruction paths as untrusted relative paths.
- Reject duplicate IDs, duplicate aliases, alias-to-ID collisions, and escaped package paths.
- Generate extension catalog output deterministically from canonical packages.

---

### Task 1: Restore and harden the manifest contract

- Add the versioned manifest schema and TypeScript validation API.
- Add positive and negative tests for guidance, executable, unknown-field, and approval rules.
- Add two canonical packages: systematic debugging and project path containment.

### Task 2: Implement filesystem discovery and registry resolution

- Discover `packages/**/manifest.json` deterministically.
- Load optional instruction files inside the package boundary.
- Build an immutable registry indexed by canonical ID and aliases.
- Reject collisions, self-dependencies, and path escapes.

### Task 3: Generate the extension catalog

- Add a deterministic generator with write and check modes.
- Commit generated catalog output.
- Add tests proving aliases and compatibility fallback behavior.

### Task 4: Wire workspace activation

- Replace the embedded debugging record with the canonical generated guidance record.
- Preserve five unmigrated legacy guidance records and all custom records.
- Resolve profile and stored legacy IDs to canonical IDs without breaking caller-supplied custom registries.

### Task 5: Verify

- Add tests to the root Node test command.
- Add catalog drift checking to the verification pipeline.
- Run root, extension companion, Linux, and Windows verification.
- Review the exact branch diff and report any remaining migration work.
