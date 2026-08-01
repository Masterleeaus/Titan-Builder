# Titan Builder V2.6 Deep-Scan Issue Ledger

## Repository and source

- Repository: `Masterleeaus/Titan-Builder`
- Base branch: `main`
- Repair branch: `agent/fix-titan-builder-v2.6-deep-scan`
- Draft pull request: `#1`
- Source archive: `OpenBrowser-v0.5.0-Project-Intelligence-Port.zip`
- Archive SHA-256: `f6fe0e149e776470ec220db60ca5ac06bedad06e458860825c223c09dfaa6f8c`
- Archive inspection: 147 entries; one `OpenBrowser-v0.5.0/` wrapper; no traversal paths, absolute paths, symlink entries, duplicate paths, case collisions, or executable bits.
- Source expansion: complete on the repair branch through a guarded GitHub Actions import.
- Created: 2026-08-02 Australia/Sydney
- Last updated: 2026-08-02 Australia/Sydney

## Verification state

- Original dependency-free baseline: 83/83 tests plus extension integrity.
- Current dependency-free repair gate: 100/100 tests plus extension integrity.
- Dependencies install successfully in GitHub Actions with pnpm 11.2.2 and the frozen lockfile.
- Full verification is active. The first run exposed NodeNext-incompatible integration imports; the second exposed strict-nullability gaps at the canonical path boundary. Both root causes have been repaired and the next full run is pending.
- Windows-native junction verification remains required before OB-002 can be marked fully verified.

## Status legend

- `TODO`: not started.
- `IN PROGRESS`: active investigation or implementation.
- `FIXED`: implementation exists but platform/full verification is incomplete.
- `VERIFIED`: targeted regression and the applicable available gates passed.
- `BLOCKED`: documented external dependency prevents progress.

## Complete finding register

| ID | Severity | Finding | Status |
|---|---|---|---|
| OB-001 | Critical | Host-wide `x.com` Grok routing can inject or submit into an ordinary X composer | VERIFIED on repair branch; full pipeline pending |
| OB-002 | Critical | Lexical root checks allow symlink/junction escape outside the authorised project | FIXED on repair branch; Linux tests pass; Windows junction verification pending |
| OB-003 | High | Global operation sorting reverses dependencies and changes approved intent | VERIFIED on repair branch; full pipeline pending |
| OB-004 | High | Planning is not stateful and multi-operation application is not transactional | TODO — next repair target |
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
| OB-026 | Medium | Release tests omit the most safety-critical edge cases | IN PROGRESS through added regressions and restored CI |

## Active repair evidence

### OB-001 — verified on repair branch

Root cause: the manifest, tab routing, provider map, and generic textarea/submit selectors accepted all `x.com` pages as Grok.

Implemented:

- Removed all `x.com` permissions and routing.
- Restricted Grok to supported `grok.com` chat paths.
- Added provider-specific root markers and fail-closed composer/send checks.
- Added negative fixtures for X home, compose, replies, messages, profiles, status pages, sibling-host spoofing, and generic composers.

Evidence:

- RED: four expected failures before the fix.
- GREEN: 14/14 targeted tests.
- Included in the current 100/100 dependency-free gate.
- Local source commit: `7f0a9dc`.
- Remote repair commit: `6aa069a5250cf8d41a6d355d5e9227494512706a`.

### OB-002 — fixed on repair branch

Root cause: `path.resolve`/`path.relative` checked lexical containment only, allowing intermediate symlinks or junctions to redirect writes, deletes, renames, and tool working directories outside the project.

Implemented:

- Canonical project-root and path resolver using `realpath` and component-by-component `lstat`.
- Rejects traversal, sibling-prefix confusion, symlink/junction components, terminal symlinks, invalid target types, and missing required CWDs.
- Resolves the nearest existing ancestor for new targets.
- Revalidates every operation immediately before mutation or execution.
- Uses `O_NOFOLLOW` file descriptors where supported and validates parents before writes and moves.
- Narrows optional operation paths through a checked execution-boundary helper rather than unsafe assertions.

Evidence:

- RED: canonical module and operation wiring absent; later full typecheck exposed unchecked optional-path usage at the execution boundary.
- GREEN: 9/9 targeted security tests and 100/100 dependency-free tests.
- Local source commits: `34e0122`, `2fb080d`.
- Remote repair commits: `6aa069a5250cf8d41a6d355d5e9227494512706a`, `0f105fbd3f8aaced82f1273265bbe9fa9bf4a4b9`.
- Remaining: full dependency-backed pipeline and Windows-native junction checks.

### OB-003 — verified on repair branch

Root cause: parsing and planning globally sorted by action type instead of preserving the sequence shown for approval.

Implemented:

- Replaced internal global sorting with explicit order preservation.
- Safe mkdir-only conversion remains in its original position.
- Added rename→edit, delete→recreate, create→tool, repeated-edit, and input-mutation tests.

Evidence:

- RED: 3/5 tests failed against the original sorter, including both audit reproductions.
- GREEN: 5/5 targeted tests.
- Included in the current 100/100 dependency-free gate.
- Local source commit: `4d11fae`.
- Remote repair commit: `6aa069a5250cf8d41a6d355d5e9227494512706a`.

### CI defects repaired while validating the branch

1. `src/server/workflow.integration.ts` used explicit `.ts` suffixes under NodeNext without `allowImportingTsExtensions`; imports now use emitted `.js` specifiers. Remote commit: `75e817f3c7b57c6b09b369496aa69f64feb1c42e`.
2. File-operation paths were optional in the shared operation interface. Execution now performs an explicit checked narrowing before every file mutation or revalidation instead of relying on non-null assertions. Remote commit: `0f105fbd3f8aaced82f1273265bbe9fa9bf4a4b9`.

## Next execution sequence

1. Complete the full pnpm verification pipeline on the repaired head and fix each newly exposed root cause.
2. Add Windows CI coverage for junction/reparse-point containment behavior.
3. Begin OB-004 with failing tests for stateful preview and all-or-nothing multi-operation application.
4. Continue in severity order with OB-005.
5. Keep this ledger and draft PR body synchronized with test evidence, commit SHAs, residual risk, and exact blockers.
6. Keep PR #1 in draft until the required gates are green and security review is complete.
