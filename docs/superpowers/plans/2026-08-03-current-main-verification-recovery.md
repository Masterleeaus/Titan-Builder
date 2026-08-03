# Current Main Verification Recovery

## Goal

Restore the current `main` branch to a fully verified state without reverting the security, transaction, process-tree, tool-library, or skill-library work that landed on August 3, 2026.

## Method

1. Capture the current Linux and Windows failures on an unchanged production tree.
2. Fix only observed compile, test, and integration regressions.
3. Preserve every newer security invariant while reconciling overlapping implementations.
4. Require root, companion, workflow-policy, security, generated-catalog, and dependency checks to pass on the exact final head.
5. Merge this recovery before refreshing older security pull requests.

## Known suspicious merge artifacts to verify

- unresolved rollback variable references in `src/operations/index.ts`
- stale post-process output references after the process-tree runner refactor
- inconsistent diff-size constant names
- missing structured logger imports
- root manifest drift from the current lockfile and test inventory

No item is considered fixed until the workflow output proves it.
