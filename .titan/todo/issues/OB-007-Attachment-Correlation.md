# OB-007 — Attachment Correlation and Exact Composer Verification

- Severity: High
- Branch: `agent/fix-titan-builder-v2.6-deep-scan`
- Status: VERIFIED
- Source commit: `e28c5fc4b7a09856cee11814ccbd82d295b072cb`
- Documentation verification commit: `31e656253c8e1abf64cb755a991f4b01db7ee6cc`
- Artifact SHA-256: `f5315b9aa3b9c89bd4b085e9a851ba9bd023dfa01f44728bfd598ce550020c11`
- Offline applicator run: `30724250738`
- Offline applicator job: `91432941538`
- Full verification run: `30724273543`
- Full verification job: `91432999078`

## Confirmed defects

1. Any existing attachment-preview element could satisfy upload completion.
2. Generic preview text such as `txt` or `.txt` was accepted instead of the expected filename.
3. The uploader did not take a before-state snapshot, so an unrelated pre-existing attachment could be mistaken for the current job's file.
4. Composer injection verification accepted content when its length was at least 85% of the intended prompt, allowing stale or different text of similar size to pass.
5. Every job used the same `openbrowser-prompt.txt` filename, making cross-job correlation weak.

## Red evidence

Failure-first tests proved the original implementation lacked:

- A verification runtime loaded before the content script.
- Exact filename and size matching.
- New before/after attachment evidence.
- A unique per-session attachment marker.
- Normalized composer equality.

The original source explicitly accepted `text.includes('.txt')` and used `actual.length >= expected.length * 0.85`.

## Implemented repair

- Generates a unique normalized filename for each session, such as `openbrowser-prompt-session-id.txt`.
- Records matching attachment-preview state before upload.
- Requires a new matching preview node or evidence key after the upload attempt.
- Accepts only the exact normalized filename or the generated per-job marker.
- Verifies the selected `File` using exact normalized filename and byte size before waiting for the preview.
- Rejects generic `txt`, `.txt`, unrelated filenames, and unchanged pre-existing preview state.
- Uses normalized exact equality for textarea, input, Lexical, and ProseMirror composer verification.
- Blocks submission when the final composer does not exactly match the intended prompt.
- Removes attachment presence as a substitute for actual composer content during send readiness.
- Fails closed to text injection when an exact new attachment preview cannot be established.

## Test coverage

- Generic and unrelated attachment evidence rejection.
- Exact filename and generated marker acceptance.
- Exact selected-file name and byte-size correlation.
- Unchanged pre-existing preview rejection.
- New preview-node and new evidence-key acceptance.
- CRLF, non-breaking-space, and zero-width normalization.
- Similar-length stale content rejection.
- Extra and truncated composer content rejection.
- Manifest ordering and source-wiring guards.
- Unique per-session prompt filename generation.

## Green evidence

The guarded applicator passed:

- Artifact checksum and exact seven-path allowlist.
- 116/116 dependency-free Node tests.
- Extension integrity.
- Commit and push to the repair branch.

GitHub Actions run `30724273543`, job `91432999078` passed:

- TypeScript typecheck.
- 116/116 Node tests.
- 4/4 dependency-backed integration tests.
- Production build.
- CLI smoke test.
- Manifest V3 extension integrity.

The acceptance criteria are satisfied. Attachment completion now requires new, exact, per-job evidence, and composer submission requires normalized equality with the intended prompt.
