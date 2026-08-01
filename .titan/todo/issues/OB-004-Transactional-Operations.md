# OB-004 — Stateful Planning and Transactional Application

- Severity: High
- Branch: `agent/fix-titan-builder-v2.6-deep-scan`
- Status: VERIFIED
- Source commit: `f20bd93a7ff11ccb93d36652529e32b6f6a84073`
- Verification run: `30723710993`
- Verification job: `91431555309`

## Confirmed defects

1. Repeated edits were previewed independently from the original disk state. A second edit searching for content created by the first edit failed during planning.
2. Multi-operation application was not atomic. When a later operation failed, earlier writes remained and no rollback result was recorded.
3. Execution rebuilt state from raw operations instead of enforcing the state and preconditions represented by the approved plan.

## Red evidence

GitHub Actions run `30723345611`, job `91430626148` reproduced both original defects:

- Stateful preview failed with `Search text not found in notes.txt` on the second edit.
- Transaction application failed without restoring the earlier write or recording rollback.

## Implemented repair

- Sequential virtual file state during planning.
- SHA-256 path-state preconditions captured in the approved plan.
- `executePlannedOperations` executes the approved plan and rejects stale previews.
- Durable transaction journal under `.openbrowser/transactions`.
- Before-state backups for affected files and newly created paths.
- Automatic rollback when any later operation fails.
- Rollback status, failure details, transaction ID, operation count, and failed step recorded in history.
- Sibling temporary-file writes followed by rename for atomic replacement where supported.
- CLI execution paths use approved plans rather than silently rebuilding them.
- Journal records when external tool or command side effects may not be reversible by filesystem rollback.

## Green evidence

GitHub Actions run `30723710993`, job `91431555309` passed:

- 101/101 Node tests.
- Stateful sequential-preview integration.
- Stale approved-plan rejection integration.
- Multi-file rollback restoration and journal integration.
- Bridge workflow integration.
- TypeScript typecheck.
- Production build.
- CLI smoke test.
- Extension integrity check.

The issue is verified for the tested Linux environment. Cross-platform atomic-replace behavior remains part of normal platform hardening, but no known OB-004 acceptance criterion remains open.
