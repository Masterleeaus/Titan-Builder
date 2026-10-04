# Identity-Preserving Filesystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every security-critical read, hash, backup, edit, create, delete, and rename operates on the same filesystem objects and verified parent directories that were approved.

**Architecture:** Introduce a focused filesystem-identity module that opens and validates existing files once, exposes stable device/inode identity and bytes from the same handle, and provides guarded mutation primitives. Existing operation planning, precondition verification, transaction backup, apply, and rollback code will consume these primitives instead of validating a pathname and reopening it later. Linux uses no-follow descriptors and directory-descriptor-relative paths; Windows uses reparse-aware identity checks around native handle operations and fails closed where identity cannot be retained.

**Tech Stack:** Node.js 22, TypeScript, `node:fs/promises`, Linux `/proc/self/fd` directory-descriptor paths where available, Windows file IDs/reparse metadata exposed through platform-specific helpers, Node test runner, GitHub Actions Linux and Windows matrices.

## Global Constraints

- Preserve current operation JSON, preview, transaction-journal, rollback, and history compatibility.
- Never follow symbolic links, junctions, mount redirects, or reparse points during security-critical work.
- The object read for preview must be the object hashed and copied into the transaction backup.
- Parent directories must remain identity-bound through mutation completion.
- Unsafe races fail closed without outside-project reads or writes.
- Tests must run on native Linux and Windows GitHub Actions runners without timing-only assertions.
- Do not add a dependency that requires arbitrary post-install code or weakens the existing security workflow.

---

### Task 1: Stable existing-file handles

**Files:**
- Create: `src/security/verified-file.ts`
- Create: `src/security/verified-file.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `openVerifiedRegularFile(filePath: string): Promise<VerifiedRegularFile>`
- Produces: `VerifiedRegularFile.identity`, `VerifiedRegularFile.mode`, `VerifiedRegularFile.readBuffer()`, and `VerifiedRegularFile.close()`
- Produces: `sameFileIdentity(left, right): boolean`

- [ ] **Step 1: Write a failing regular-file test**

Create a file, open it through `openVerifiedRegularFile()`, and assert that bytes, mode, and stable device/inode identity are returned from the opened handle.

- [ ] **Step 2: Write a failing target-swap test**

Use a test hook after the initial pathname inspection to replace the target with a symlink on POSIX or a distinct file on Windows. Assert that the helper rejects and never returns outside bytes.

- [ ] **Step 3: Run the focused test**

Run: `node --experimental-strip-types --test src/security/verified-file.test.ts`

Expected: FAIL because `verified-file.ts` does not exist.

- [ ] **Step 4: Implement stable open and validation**

Open existing files with read-only and no-follow flags where supported. Capture pre-open pathname metadata, opened-handle metadata, and post-open pathname metadata. Require all identities to match, require a regular file, reject symbolic links/reparse redirects, and expose reads only through the retained handle.

- [ ] **Step 5: Run the focused test and typecheck**

Run: `node --experimental-strip-types --test src/security/verified-file.test.ts`

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat(security): add stable verified file handles (#128)`

### Task 2: Bind preview, hash, and transaction backup to one object

**Files:**
- Modify: `src/operations/index.ts`
- Create: `src/operations/file-identity.integration.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `openVerifiedRegularFile()` from Task 1.
- Produces: `readPathSnapshot()` snapshots whose bytes, hash, mode, and identity all come from one retained file handle.
- Produces: transaction backups written from the approved snapshot bytes, never by reopening the source pathname.

- [ ] **Step 1: Write a failing preview/read race test**

Arrange a deterministic hook that swaps the target after pathname validation but before read. Assert that planning rejects and outside bytes never appear in the generated diff.

- [ ] **Step 2: Write a failing backup race test**

Plan an edit, replace the target between precondition verification and transaction backup, and assert that execution rejects before mutation and the backup cannot contain bytes from the replacement object.

- [ ] **Step 3: Run the focused integration tests**

Run: `tsx --test src/operations/file-identity.integration.test.ts`

Expected: FAIL against the pathname-reopen implementation.

- [ ] **Step 4: Refactor snapshot reads**

Read existing target content and metadata from `VerifiedRegularFile`. Add the stable identity to internal snapshots and preconditions. Preserve the public preview and journal schema unless a new optional identity field is required for fail-closed verification.

- [ ] **Step 5: Refactor transaction backups**

Persist backup bytes captured from the same verified snapshot used for planning/precondition verification. Do not call `copyFile(snapshot.absolutePath, backupPath)`.

- [ ] **Step 6: Run focused and transaction suites**

Run: `tsx --test src/operations/file-identity.integration.test.ts src/operations/transaction.integration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit: `fix(security): bind operation previews and backups to file identity (#128)`

### Task 3: Identity-bound parent directories

**Files:**
- Extend: `src/security/verified-file.ts`
- Extend: `src/security/verified-file.test.ts`
- Modify: `src/operations/index.ts`

**Interfaces:**
- Produces: `openVerifiedDirectory(directoryPath: string): Promise<VerifiedDirectory>`
- Produces: stable parent identity, descriptor-relative child resolution, and `assertCurrentPathIdentity()`.

- [ ] **Step 1: Add deterministic parent-replacement tests**

Open a verified parent, rename it away, replace the pathname with a symlink/junction, and assert child operations remain attached to the original parent or fail before creating outside content.

- [ ] **Step 2: Implement verified directory handles**

Retain a directory handle and identity. On Linux, use descriptor-relative paths rooted through the open directory descriptor. On Windows, reject reparse points and verify volume/file IDs immediately before and after native handle operations.

- [ ] **Step 3: Add platform capability checks**

Fail closed with a clear error when descriptor-relative or native identity guarantees are unavailable. Never fall back silently to pathname-only mutation.

- [ ] **Step 4: Run Linux and Windows focused tests**

Run the same test file on both GitHub Actions runners.

- [ ] **Step 5: Commit**

Commit: `feat(security): retain verified parent directory identity (#128)`

### Task 4: Guard creates and edits through replacement

**Files:**
- Modify: `src/operations/index.ts`
- Extend: `src/operations/file-identity.integration.test.ts`

**Interfaces:**
- Consumes: verified parent directories from Task 3.
- Produces: `writeVerifiedReplacement()` that writes a temporary file inside the held parent and atomically replaces only the expected destination identity.

- [ ] **Step 1: Add create-parent and edit-target swap tests**

Swap every pathname component at the deterministic hook before temp creation, before rename, and immediately after rename. Assert no outside file is created and no unapproved identity is replaced.

- [ ] **Step 2: Implement guarded replacement**

Create the temporary file relative to the retained parent, write and sync content, compare the destination identity to the approved precondition, atomically rename relative to the same parent, and verify the resulting path remains attached to that parent.

- [ ] **Step 3: Preserve mode and cleanup semantics**

Apply the approved mode to replacement files and remove only temporary files proven to be inside the retained parent.

- [ ] **Step 4: Run operation and rollback suites**

Run: `pnpm run test:node && pnpm run test:integration`

- [ ] **Step 5: Commit**

Commit: `fix(security): identity-bind create and edit replacement (#128)`

### Task 5: Guard deletes and renames

**Files:**
- Modify: `src/operations/index.ts`
- Extend: `src/operations/file-identity.integration.test.ts`

**Interfaces:**
- Produces: `unlinkVerifiedChild()` and `renameVerifiedChild()` operating relative to retained directory identities.

- [ ] **Step 1: Add target, source-parent, and destination-parent swap tests**

Cover deletion target replacement, source-parent replacement, destination-parent replacement, cross-parent rename, junction/reparse substitution, and destination creation races.

- [ ] **Step 2: Implement identity-bound delete**

Require the current child identity to equal the approved identity, unlink through the retained parent, and verify that no outside object was touched.

- [ ] **Step 3: Implement identity-bound rename**

Hold both source and destination parent identities, require the source child identity and missing destination precondition, perform one native rename, and verify both parent identities afterward.

- [ ] **Step 4: Run focused stress tests**

Execute repeated component swaps coordinated by barriers rather than sleeps. Assert the attacker never wins an outside read or write.

- [ ] **Step 5: Commit**

Commit: `fix(security): identity-bind delete and rename operations (#128)`

### Task 6: Rollback and full-system verification

**Files:**
- Modify: `src/operations/index.ts`
- Extend: `src/operations/transaction.integration.test.ts`
- Extend: `src/operations/rollback-metadata.integration.test.ts`
- Update: `docs/superpowers/plans/2026-08-02-identity-preserving-filesystem.md`

**Interfaces:**
- Consumes all verified read and mutation primitives.
- Produces rollback restoration that operates on retained identities and backup bytes without pathname reopening.

- [ ] **Step 1: Add combined apply-and-rollback race tests**

Swap target, parent, backup, journal, and project-root components at every transaction boundary. Assert outside sentinels remain byte-for-byte unchanged and trusted evidence is preserved.

- [ ] **Step 2: Route rollback through verified primitives**

Preserve #116 project-root identity, relative destinations, target-parent checks, and backup containment while replacing pathname-based restore mutations with retained directory/file identities.

- [ ] **Step 3: Run complete verification**

Run: `pnpm run verify`

Run: `cd browser-extension && pnpm run verify`

Run both on Linux and Windows GitHub Actions.

- [ ] **Step 4: Review final diff and threat model**

Confirm reads, hashes, backups, creates, edits, deletes, renames, rollback, journal writes, history writes, and cleanup have no validate-then-reopen path remaining.

- [ ] **Step 5: Commit and publish**

Commit: `fix(security): eliminate operation pathname TOCTOU (#128)`

Open a pull request that closes #128 and includes platform-specific evidence, stress-test counts, limitations, and exact workflow results.
