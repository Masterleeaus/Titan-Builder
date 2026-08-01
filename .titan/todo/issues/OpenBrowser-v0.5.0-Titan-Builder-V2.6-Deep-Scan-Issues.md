# Titan Builder V2.6 Deep-Scan Issue Ledger

## Repository and source

- Repository: `Masterleeaus/Titan-Builder`
- Base branch: `main`
- Repair branch: `agent/fix-titan-builder-v2.6-deep-scan`
- Source archive: `OpenBrowser-v0.5.0-Project-Intelligence-Port.zip`
- Archive SHA-256: `f6fe0e149e776470ec220db60ca5ac06bedad06e458860825c223c09dfaa6f8c`
- Archive inspection: 147 entries; one `OpenBrowser-v0.5.0/` wrapper; no traversal paths, absolute paths, symlink entries, duplicate paths, case collisions, or executable bits.
- Created: 2026-08-02 Australia/Sydney

## Verification baseline

- Dependency-free baseline passed 83/83 tests and extension integrity.
- Full pnpm/typecheck/build verification is environment-blocked because the execution runtime cannot resolve `registry.npmjs.org`.
- Current local repair baseline passes 100/100 dependency-free tests and extension integrity.
- Remote extraction is not yet complete: connector-created commits did not trigger the guarded extraction workflow, and this runtime cannot reach GitHub through git. Do not treat the source as expanded on this branch until repository contents prove it.

## Status legend

- `TODO`: not started.
- `IN PROGRESS`: active investigation or implementation.
- `FIXED`: implementation exists but platform/full verification is incomplete.
- `VERIFIED`: targeted regression and available adjacent/full gates passed.
- `BLOCKED`: documented external dependency prevents progress.

## Complete finding register

| ID | Severity | Finding | Status |
|---|---|---|---|
| OB-001 | Critical | Host-wide `x.com` Grok routing can inject or submit into an ordinary X composer | VERIFIED locally; remote sync pending |
| OB-002 | Critical | Lexical root checks allow symlink/junction escape outside the authorised project | FIXED locally; Windows/full integration pending |
| OB-003 | High | Global operation sorting reverses dependencies and changes approved intent | VERIFIED locally; remote sync pending |
| OB-004 | High | Planning is not stateful and multi-operation application is not transactional | TODO |
| OB-005 | High | ZIP export crashes far below its advertised 15 MB entry limit | TODO |
| OB-006 | High | Active workspace skills and profiles can be omitted from CLI-created jobs | TODO |
| OB-007 | High | Attachment detection can accept an unrelated pre-existing file | TODO |
| OB-008 | High | Bridge authentication, origin checks, and approval boundaries are weaker than documented | TODO |
| OB-009 | High | npm/pnpm scripts and lifecycle execution are labelled safer than their arbitrary-code capability | TODO |
| OB-010 | High | Session, prompt, chunk, and response retention is unbounded | TODO |
| OB-011 | High | Unlabelled Markdown/YAML fences can be attached to the wrong target file | TODO |
| OB-012 | Medium | Secondary JSON balancing does not correctly account for strings and escapes | TODO |
| OB-013 | Medium | Legacy context helpers retain path-prefix and symlink containment weaknesses | TODO |
| OB-014 | Medium | Search/replace and line edits can silently modify an unintended region | TODO |
| OB-015 | Medium | Conversation fallback can export a user message as an assistant reply | TODO |
| OB-016 | Medium | Context and diff paths read entire large files before applying limits | TODO |
| OB-017 | Medium | Tool timeout/output enforcement may leave descendant processes running | TODO |
| OB-018 | Medium | Registry, memory, and history writes can lose concurrent updates | TODO |
| OB-019 | Medium | Edit history is too shallow for recovery and forensic audit | TODO |
| OB-020 | Medium | Server validation and HTTP error semantics are inconsistent | TODO |
| OB-021 | Medium | Job recovery does not survive a bridge-process restart | TODO |
| OB-022 | Low/Medium | Selecting an active registered project does not change operation roots | TODO |
| OB-023 | Low/Medium | Documented branch operations are implemented as read-only inspection | TODO |
| OB-024 | Low | `SECURITY.md` support table and version wording are stale | TODO |
| OB-025 | Low/Medium | Titan Builder product/version identity and upstream attribution are absent | TODO |
| OB-026 | Medium | Release tests omit the most safety-critical edge cases | IN PROGRESS through added regressions |

## Active repair evidence

### OB-001 — verified locally

Root cause: the manifest, tab routing, provider map, and generic textarea/submit selectors accepted all `x.com` pages as Grok.

Implemented locally:

- Removed all `x.com` permissions and routing.
- Restricted Grok to supported `grok.com` chat paths.
- Added provider-specific root markers and fail-closed composer/send checks.
- Added negative fixtures for X home, compose, replies, messages, profiles, status pages, sibling-host spoofing, and generic composers.

Evidence:

- RED: four expected failures before the fix.
- GREEN: 14/14 targeted tests.
- Full available offline gate: 86/86 plus extension integrity.
- Local commit: `7f0a9dc`.

### OB-002 — fixed locally

Root cause: `path.resolve`/`path.relative` checked lexical containment only, allowing intermediate symlinks or junctions to redirect writes, deletes, renames, and tool working directories outside the project.

Implemented locally:

- Canonical project-root and path resolver using `realpath` and component-by-component `lstat`.
- Rejects traversal, sibling-prefix confusion, symlink/junction components, terminal symlinks, invalid target types, and missing required CWDs.
- Resolves nearest existing ancestor for new targets.
- Revalidates every operation immediately before mutation/execution.
- Uses `O_NOFOLLOW` file descriptors where supported and validates parents before writes/moves.

Evidence:

- RED: canonical module and operation wiring absent.
- GREEN: 9/9 targeted tests.
- Full available offline gate: 95/95 plus extension integrity.
- Local commit: `34e0122`.
- Remaining: dependency-backed operation integration and Windows-native junction checks.

### OB-003 — verified locally

Root cause: parsing and planning globally sorted by action type instead of preserving the sequence shown for approval.

Implemented locally:

- Replaced internal global sorting with explicit order preservation.
- Safe mkdir-only conversion remains in its original position.
- Added rename→edit, delete→recreate, create→tool, repeated-edit, and input-mutation tests.

Evidence:

- RED: 3/5 tests failed against the original sorter, including both audit reproductions.
- GREEN: 5/5 targeted tests.
- Full available offline gate: 100/100 plus extension integrity.
- Local commit: `4d11fae`.

## Required next sequence

1. Finish secure source expansion into the repair branch without overwriting `.git`, `.github`, `.titan`, or the source ZIP.
2. Synchronise the locally verified OB-001–OB-003 commits or equivalent patch content.
3. Run dependency-backed CI on Linux and Windows.
4. Continue in severity order with OB-004 and OB-005.
5. Keep this ledger updated with root cause, tests, commit SHA, verification output, and remaining risk for every finding.
6. Open a draft pull request to `main` only after source expansion and at least one verified repair are visible on the remote branch.
