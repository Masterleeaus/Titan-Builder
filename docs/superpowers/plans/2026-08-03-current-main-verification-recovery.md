# Current Main Verification Recovery

## Goal

Restore the current `main` branch to a fully verified state without reverting the security, transaction, process-tree, tool-library, or skill-library work that landed on August 3, 2026.

## Method

1. Capture the current Linux and Windows failures on an unchanged production tree.
2. Fix only observed compile, test, and integration regressions.
3. Preserve every newer security invariant while reconciling overlapping implementations.
4. Require root, companion, workflow-policy, security, generated-catalog, and dependency checks to pass on the exact final head.
5. Merge this recovery before refreshing older security pull requests.

## Observed failures

The unchanged current-main tree failed before compilation on both native platforms because `pnpm-lock.yaml` contained a duplicate `braces@3.0.3` mapping. The root manifest had also been replaced with an older dependency and test inventory that did not match the lockfile.

Workflow policy independently rejected three completed issue-controller workflows because they retained write permissions and checkout credentials in the production tree:

- `.github/workflows/apply-issue-119.yml`
- `.github/workflows/apply-issue-24-controller.yml`
- `.github/workflows/retry-issue-119-publish.yml`

## Applied repair

- Restored the last verified root package, dependency, export, and test contract.
- Regenerated `pnpm-lock.yaml` from scratch with pnpm 11.2.2 and lifecycle scripts disabled.
- Proved the regenerated lock accepts a frozen install before publishing it.
- Removed the three completed write-enabled controller workflows.
- Reconciled the root context, operations, project-path, server, session, Skill Library, and Tool Library contracts.
- Reconciled the companion environment loader, user-scoped database migration, authenticated bridge forwarding, and error-envelope contracts.
- Activated a one-shot publisher that verifies root and companion packages and removes its own recovery artifacts before committing.

## Final verification

The published final head must pass the standard Linux, Windows, companion, workflow-policy, security, catalog, and dependency matrices before merge. No pre-publication workflow result will be reused as final evidence.
