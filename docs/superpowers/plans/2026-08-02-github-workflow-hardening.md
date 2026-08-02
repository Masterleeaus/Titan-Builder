# GitHub Workflow Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable required CI gate, targeted specialist verification, scheduled security checks, immutable Action pinning, and grouped Dependabot updates for Titan Builder.

**Architecture:** Keep `verify.yml` as the always-running cross-platform merge gate, retain `workspace-tools.yml` as a path-filtered specialist workflow, add a local Python policy checker plus tests, and add a separate informational security workflow. Dependabot manages root, browser-extension, and GitHub Actions updates independently.

**Tech Stack:** GitHub Actions YAML, Python 3.12, PyYAML 6.0.2, Node.js 22, pnpm 11.2.2, Python `unittest`.

## Global Constraints

- Work only on branch `github-workflow-hardening`.
- Never modify `main` directly.
- Keep workflow permissions read-only.
- Set `persist-credentials: false` on every checkout.
- Pin external Actions to full 40-character commit SHAs.
- Keep Node.js at 22, Python at 3.12, and pnpm at 11.2.2.
- Run root and `browser-extension/` verification on Linux and Windows.
- Keep network-dependent vulnerability findings informational during initial rollout.
- Do not use `pull_request_target`.
- Do not add repository secrets or write permissions.
- Preserve draft and stacked pull-request behavior.
- Expose one required status named exactly `required-ci`.

---

### Task 1: Commit approved design and implementation plan

**Files:**
- Create: `docs/superpowers/specs/2026-08-02-github-workflow-hardening-design.md`
- Create: `docs/superpowers/plans/2026-08-02-github-workflow-hardening.md`

**Interfaces:**
- Consumes: Approved conversation design.
- Produces: Canonical design and implementation records.

- [ ] Commit the approved design specification.
- [ ] Commit this implementation plan.
- [ ] Verify both files exist on `github-workflow-hardening`.

### Task 2: Add failing workflow-policy tests

**Files:**
- Create: `scripts/tests/test_check_github_workflows.py`

**Interfaces:**
- Consumes: `check_repository(root: Path) -> list[Violation]`.
- Produces: Tests for YAML parsing, permissions, timeouts, immutable Action SHAs, checkout credential persistence, unsafe triggers, and stable required gate naming.

- [ ] Add tests that import `scripts.check_github_workflows`.
- [ ] Cover one valid workflow and one fixture per policy violation.
- [ ] Run `python -m unittest scripts.tests.test_check_github_workflows -v`.
- [ ] Confirm failure occurs because `scripts.check_github_workflows` does not exist.
- [ ] Commit the red tests.

### Task 3: Implement workflow-policy checker

**Files:**
- Create: `scripts/check_github_workflows.py`

**Interfaces:**
- Produces:
  - `Violation(path: str, rule: str, message: str)`
  - `check_repository(root: Path) -> list[Violation]`
  - CLI exit code `0` when compliant and `1` when violations exist.

- [ ] Parse all `.github/workflows/*.yml` and `*.yaml` using `yaml.safe_load`.
- [ ] Require explicit top-level permissions and reject `write-all`.
- [ ] Reject `pull_request_target`.
- [ ] Require `timeout-minutes` for every job.
- [ ] Require every external `uses:` reference to use a full 40-character SHA.
- [ ] Allow only `actions/checkout`, `actions/setup-node`, and `actions/setup-python`.
- [ ] Require `persist-credentials: false` for checkout steps.
- [ ] Require `verify.yml` to contain job ID and display name `required-ci`.
- [ ] Run the policy tests and confirm they pass.
- [ ] Commit the implementation.

### Task 4: Harden the required CI workflow

**Files:**
- Modify: `.github/workflows/verify.yml`

**Interfaces:**
- Produces status checks `verify-linux`, `verify-windows`, `workflow-policy`, and `required-ci`.

- [ ] Replace the matrix with explicit Linux and Windows jobs.
- [ ] Add PR-only concurrency cancellation while preserving all `main` runs.
- [ ] Pin checkout, setup-node, and setup-python to approved full SHAs.
- [ ] Disable persisted checkout credentials.
- [ ] Run root and browser-extension verification on both operating systems.
- [ ] Add the workflow-policy job and install `PyYAML==6.0.2`.
- [ ] Add fail-closed `required-ci` with `if: always()`.
- [ ] Run the local checker against the workflow.
- [ ] Commit the workflow update.

### Task 5: Harden targeted workspace verification

**Files:**
- Modify: `.github/workflows/workspace-tools.yml`

**Interfaces:**
- Produces path-filtered specialist checks only.

- [ ] Add concurrency cancellation.
- [ ] Pin all Actions to full SHAs.
- [ ] Disable persisted checkout credentials.
- [ ] Preserve Linux, Windows, Python, Bash, PowerShell, tests, and build coverage.
- [ ] Keep it outside the global required-check contract.
- [ ] Run the local policy checker.
- [ ] Commit the workflow update.

### Task 6: Add security workflow

**Files:**
- Create: `.github/workflows/security.yml`

**Interfaces:**
- Produces scheduled/manual/change-triggered security summaries.

- [ ] Trigger weekly, manually, and for dependency/workflow changes.
- [ ] Use read-only permissions and PR concurrency cancellation.
- [ ] Validate workflow policy and generated catalogs.
- [ ] Verify lockfile installation with scripts disabled.
- [ ] Run root and browser-extension `pnpm audit` as informational checks.
- [ ] Write audit results to the GitHub step summary.
- [ ] Avoid secrets, write permissions, and `pull_request_target`.
- [ ] Run the local policy checker.
- [ ] Commit the workflow.

### Task 7: Add grouped Dependabot configuration

**Files:**
- Create: `.github/dependabot.yml`

**Interfaces:**
- Produces weekly root npm, browser-extension npm, and GitHub Actions update PRs.

- [ ] Add root npm updates with five-PR limit and patch/minor grouping.
- [ ] Add browser-extension npm updates with independent grouping.
- [ ] Add grouped GitHub Actions updates.
- [ ] Leave major updates ungrouped for deliberate review.
- [ ] Use `Australia/Melbourne` scheduling.
- [ ] Validate YAML syntax.
- [ ] Commit the configuration.

### Task 8: Verify branch and open draft PR

**Files:**
- No new production files.

**Interfaces:**
- Produces a draft PR targeting `main`.

- [ ] Run the Python unit tests.
- [ ] Run the policy checker against all workflows.
- [ ] Validate all YAML files with PyYAML.
- [ ] Confirm no workflow grants write permissions.
- [ ] Confirm every external Action is SHA-pinned.
- [ ] Compare `github-workflow-hardening` against `main`.
- [ ] Open a draft PR documenting rollout instructions.
- [ ] Inspect the first workflow run and report any failures without enabling auto-merge.
