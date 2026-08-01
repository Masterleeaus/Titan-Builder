# Titan Builder V2.6 Deep-Scan Issue Ledger

## Repository

- Repository: `Masterleeaus/Titan-Builder`
- Base branch: `main`
- Repair branch: `agent/fix-titan-builder-v2.6-deep-scan`
- Draft pull request: `#1`
- Source archive: `OpenBrowser-v0.5.0-Project-Intelligence-Port.zip`
- Archive SHA-256: `f6fe0e149e776470ec220db60ca5ac06bedad06e458860825c223c09dfaa6f8c`
- Archive inspection: 147 entries; one wrapper directory; no traversal paths, absolute paths, symlink entries, duplicate paths, case collisions, or executable bits.
- Source expansion: complete.
- Last updated: 2026-08-02 Australia/Sydney

## Current verification baseline

The original archive passed 83 dependency-free tests. The current repair branch passes:

- 106/106 Node tests.
- 4/4 dependency-backed integration tests.
- TypeScript typecheck.
- Production build.
- CLI smoke test.
- Manifest V3 extension integrity.

Latest full verification: run `30723807441`, job `91431798561`.

Windows-native junction/reparse-point verification remains required before OB-002 can be promoted from FIXED to VERIFIED.

## Status legend

- `TODO`: not started.
- `IN PROGRESS`: active investigation or implementation.
- `FIXED`: implementation exists but a required platform or full verification gate remains.
- `VERIFIED`: regression and applicable full gates passed.
- `BLOCKED`: an external dependency prevents progress.

## Complete finding register

| ID | Severity | Finding | Status |
|---|---|---|---|
| OB-001 | Critical | Host-wide `x.com` Grok routing can inject or submit into an ordinary X composer | VERIFIED |
| OB-002 | Critical | Lexical root checks allow symlink/junction escape outside the authorised project | FIXED — Linux gates pass; Windows junction gate pending |
| OB-003 | High | Global operation sorting reverses dependencies and changes approved intent | VERIFIED |
| OB-004 | High | Planning is not stateful and multi-operation application is not transactional | VERIFIED |
| OB-005 | High | ZIP export crashes far below its advertised 15 MB entry limit | VERIFIED |
| OB-006 | High | Active workspace skills and profiles can be omitted from CLI-created jobs | TODO — next repair target |
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
| OB-026 | Medium | Release tests omit the most safety-critical edge cases | IN PROGRESS — coverage expanded from 83 to 106 Node tests plus 4 integrations |

## Verified repairs

### OB-001 — safe Grok routing

- Removed `x.com` host permissions and routing.
- Limited Grok to supported `grok.com` chat paths.
- Added provider-specific root markers and fail-closed composer/send checks.
- Added negative fixtures for X home, compose, replies, messages, profiles, status pages, sibling-host spoofing, and generic composers.
- Remote implementation commit: `6aa069a5250cf8d41a6d355d5e9227494512706a`.

### OB-002 — canonical project containment

- Added canonical root and path resolution through `realpath` and component-by-component `lstat`.
- Rejects traversal, sibling-prefix confusion, intermediate links, terminal links, invalid target types, and missing tool working directories.
- Revalidates immediately before mutation or execution and uses no-follow file descriptors where supported.
- Remote commits: `6aa069a5250cf8d41a6d355d5e9227494512706a`, `0f105fbd3f8aaced82f1273265bbe9fa9bf4a4b9`.
- Remaining: Windows-native junction/reparse-point CI.

### OB-003 — operation order preservation

- Removed global action-type sorting.
- Preserves rename→edit, delete→recreate, create→tool, and repeated-edit order.
- Remote implementation commit: `6aa069a5250cf8d41a6d355d5e9227494512706a`.

### OB-004 — stateful and transactional operations

- Sequential virtual state during preview.
- SHA-256 preconditions bind execution to the approved plan.
- Durable transaction journal and before-state backups.
- Automatic rollback, history status, rollback status, failure details, and external-side-effect warning.
- Atomic sibling-temp writes followed by rename where supported.
- Remote implementation commit: `f20bd93a7ff11ccb93d36652529e32b6f6a84073`.
- Verified by run `30723710993`, job `91431555309`.
- Detailed evidence: `OB-004-Transactional-Operations.md`.

### OB-005 — production-size ZIP export

- Replaced spread-based byte assembly with one exact-size `Uint8Array`.
- Writes ZIP structures through `DataView` and copies payloads with `.set()`.
- Added table-driven CRC32 and classic ZIP limit checks.
- Regression boundaries: 500 KB, 1 MB, 5 MB, 15 MB, and three files totalling 15 MB.
- Implementation commit: `97c01df9b4602108dc21665ed18b5e57b6895353`.
- Test commit: `f60206a8084d559e8d727a7c0c80b4d54210d31b`.
- Verified by run `30723807441`, job `91431798561`.
- Detailed evidence: `OB-005-Large-ZIP-Export.md`.

## Additional CI defects repaired

1. NodeNext integration imports now use emitted `.js` specifiers. Commit: `75e817f3c7b57c6b09b369496aa69f64feb1c42e`.
2. Operation paths are narrowed through explicit checked validation rather than unsafe assertions. Commit: `0f105fbd3f8aaced82f1273265bbe9fa9bf4a4b9`.
3. Completed and failed sessions clear transient streamed text. Commits: `cdd4c3a204992d4631572a8f01a0c4922c844ff1`, `a129cf1b4b960039ce576befc28d56cf837f733f`.
4. The test command now runs Node and integration suites exactly once instead of asking Vitest to reinterpret `node:test` files. Commits: `4e1622d124b0bdcf1019dd4b2f6bcd026793e040`, `3a53f0ea63f403b2bced59fdc98dd9e1ed52f846`.

## Next sequence

1. Repair OB-006 with failure-first tests proving workspace profiles and skills reach every CLI-created job and existing conversation.
2. Continue with OB-007 attachment correlation.
3. Add Windows CI for OB-002 junction behavior.
4. Keep this ledger and draft PR synchronized with every verified increment.
5. Keep PR #1 in draft until all release blockers and required security gates are resolved.
