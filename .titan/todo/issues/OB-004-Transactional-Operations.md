# OB-004 — Stateful Planning and Transactional Application

- Severity: High
- Branch: `agent/fix-titan-builder-v2.6-deep-scan`
- Status: FIXED — dependency-backed verification running
- Source commit: `f20bd93a7ff11ccb93d36652529e32b6f6a84073`

## Confirmed defects

1. Repeated edits were previewed independently from the original disk state. A second edit searching for content created by the first edit failed during planning.
2. Multi-operation application was not atomic. When a later operation failed, earlier writes remained and no rollback result was recorded.
3. Execution rebuilt state from raw operations instead of enforcing the state and preconditions represented by the approved plan.

## Red evidence

GitHub Actions run `30723345611`, job `91430626148` reproduced both original defects:

- Stateful preview test failed with `Search text not found in notes.txt` on the second edit.
- Transaction test failed with the original operation error and no rollback indication.

## Implemented repair

- Sequential virtual file state during planning.
- SHA-256 path-state preconditions captured in the approved plan.
- `executePlannedOperations` executes the approved plan and rejects stale previews.
- Durable transaction journal under `.openbrowser/transactions`.
- Before-state backups for affected files and newly created paths.
- Automatic rollback when any later operation fails.
- Rollback status, failure details, transaction ID, operation count, and failed step recorded in history.
- Sibling temporary-file writes followed by rename for atomic replacement where supported.
- CLI execution paths now use the approved plans rather than silently rebuilding them.
- Journal records when tool or command execution may have produced external side effects that filesystem rollback cannot reverse.

## Verification gates

- Exact binary source artifact SHA-256: `e4748eb85dc601be01efabce80e944bcce323c1fff58a702ea1e2c2e5914addc`.
- Artifact path allowlist: exactly five files.
- Dependency-free gate passed before the source commit: 101/101 tests plus extension integrity.
- Full pipeline must still prove:
  - sequential planning,
  - stale approved-plan rejection,
  - restoration of edited files,
  - removal of newly created files,
  - rollback history and journal state,
  - typecheck, build, CLI smoke, and extension integrity.

Do not mark this issue VERIFIED until the full dependency-backed run passes on the source commit above or a direct descendant.
