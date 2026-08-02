# Titan Builder GitHub Workflow Hardening Design

**Date:** 2026-08-02  
**Repository:** `Masterleeaus/Titan-Builder`  
**Proposed branch:** `github-workflow-hardening`  
**Status:** Approved design; ready for implementation planning

## 1. Objective

Improve Titan Builder's GitHub development workflow without disrupting its draft pull requests, stacked branches, Linux/Windows support, or existing verification commands.

The result must provide:

- one stable required CI status for branch protection;
- full Linux and Windows verification;
- fast cancellation of obsolete pull-request runs;
- targeted browser-extension validation;
- deterministic workflow-policy enforcement;
- scheduled and dependency-triggered security checks;
- grouped Dependabot updates;
- read-only GitHub Actions permissions;
- immutable external Action references;
- clear and actionable failure output.

## 2. Current State

The repository currently has two primary workflows:

- `.github/workflows/verify.yml`
  - runs on pushes to `main`, pull requests, and manual dispatch;
  - runs the root and browser-extension verification on Ubuntu and Windows;
  - uses read-only `contents` permission;
  - references Actions by mutable major-version tags;
  - has no concurrency cancellation;
  - exposes matrix-generated check names that rulesets must track individually.

- `.github/workflows/workspace-tools.yml`
  - runs only for browser-extension and related path changes;
  - performs deeper Linux, Windows, Python, Bash, PowerShell, typecheck, test, and build checks;
  - duplicates part of the root verification;
  - must not become a globally required check because path-filtered workflows can be skipped.

The repository uses:

- Node.js 22 or later;
- Python 3.12 in CI;
- pnpm 11.2.2;
- frozen lockfile installs;
- `pnpm run verify` at the repository root;
- `pnpm run verify` inside `browser-extension/`.

## 3. Selected Approach

Use a balanced workflow architecture that combines:

1. an always-running cross-platform required CI workflow;
2. a targeted specialist browser-extension workflow;
3. a separate security and policy workflow;
4. grouped Dependabot maintenance.

This approach preserves strong verification while avoiding the cost and fragility of making every specialist or network-dependent check mandatory.

## 4. Workflow Architecture

### 4.1 `.github/workflows/verify.yml`

This is the authoritative required merge workflow.

It runs on:

- every pull request, including drafts;
- pushes to `main`;
- manual dispatch.

It contains four stable jobs.

#### `verify-linux`

Responsibilities:

- check out the exact pull-request merge context or pushed commit;
- disable persisted checkout credentials;
- configure Node.js 22;
- configure Python 3.12;
- activate pnpm 11.2.2;
- install dependencies with `pnpm install --frozen-lockfile`;
- run `pnpm run verify` at the repository root;
- run `pnpm run verify` inside `browser-extension/`.

#### `verify-windows`

Responsibilities mirror `verify-linux` on `windows-latest`.

It must detect:

- Windows path and process behavior;
- PowerShell compatibility failures;
- platform-specific build or test failures;
- root and browser-extension regressions.

#### `workflow-policy`

This is a fast deterministic policy job.

It validates:

- all workflow YAML files parse successfully;
- each workflow declares explicit permissions;
- no workflow uses `write-all`;
- checkout steps set `persist-credentials: false`;
- all jobs define sensible timeouts;
- external Actions use approved immutable full commit SHAs;
- the required workflow and job names remain stable;
- no unsafe `pull_request_target` usage is introduced;
- dependency and generated-file policies remain consistent.

The checker must report the exact file, job, step, and violated policy.

#### `required-ci`

This is the only status intended for the `main` ruleset.

It must:

- use `if: always()`;
- depend on `verify-linux`, `verify-windows`, and `workflow-policy`;
- succeed only when every mandatory dependency job succeeds;
- fail when a mandatory job fails, is cancelled, or is unexpectedly skipped;
- produce a concise summary of the dependency-job results.

Dependency structure:

```text
verify-linux ───────┐
verify-windows ─────┼──> required-ci
workflow-policy ────┘
```

### 4.2 `.github/workflows/workspace-tools.yml`

This remains a targeted specialist workflow.

It runs only when relevant files change, including:

- `browser-extension/**`;
- browser-extension scripts and hooks;
- the workflow itself;
- directly related specifications and plans.

It provides deeper checks such as:

- Linux and Windows companion typechecking;
- TypeScript tests;
- Python tests;
- Python compilation;
- Bash syntax validation;
- PowerShell parse validation;
- companion build;
- existing root-pipeline compatibility where useful.

It is not configured as a global required status because an unrelated pull request may legitimately skip it.

The implementation should reduce unnecessary duplication with `verify.yml` while retaining specialist coverage that has distinct value.

### 4.3 `.github/workflows/security.yml`

This workflow separates deterministic repository policy from external vulnerability intelligence.

It runs:

- weekly;
- manually;
- when workflow files change;
- when package manifests or lockfiles change;
- when dependency automation configuration changes.

#### Deterministic checks

These may block relevant pull requests because they are local and repeatable:

- workflow-policy validation;
- lockfile presence and consistency;
- generated skill/catalog consistency;
- high-confidence committed-secret pattern checks;
- unsafe workflow trigger and permission checks;
- Action SHA-pinning checks.

#### External checks

These are informational during the initial rollout:

- root `pnpm audit`;
- browser-extension `pnpm audit`;
- production dependency vulnerability summaries;
- dependency-review output when supported;
- security results written to the GitHub Actions summary.

Registry or advisory-service outages must not freeze normal development. A later reviewed policy change may promote selected vulnerability severities to blocking status.

### 4.4 `.github/dependabot.yml`

Dependabot manages three update ecosystems.

#### Root npm/pnpm dependencies

- package ecosystem: `npm`;
- directory: `/`;
- schedule: weekly;
- maximum open pull requests: five;
- patch and minor upgrades grouped;
- major upgrades separated.

Suggested groups:

- runtime dependencies;
- development and test tooling;
- TypeScript tooling;
- Fastify and server packages.

#### Browser-extension dependencies

- package ecosystem: `npm`;
- directory: `/browser-extension`;
- schedule: weekly;
- maximum open pull requests: five;
- patch and minor upgrades grouped;
- major upgrades separated.

Root and browser-extension updates remain separate so failures can be isolated.

#### GitHub Actions

- package ecosystem: `github-actions`;
- directory: `/`;
- schedule: weekly;
- pinned Action SHAs updated automatically;
- Action updates grouped where appropriate.

Security updates remain prompt and are not delayed by routine grouping.

## 5. Concurrency and Cancellation

Pull-request workflows use a concurrency group based on workflow identity and pull-request number or branch reference.

Expected behavior:

- a new commit to the same PR cancels its older in-progress run;
- unrelated PRs do not cancel one another;
- pushes to `main` do not cancel earlier `main` verification runs;
- manual runs remain independently observable.

Draft PRs continue to run CI because Titan Builder relies on draft and stacked work for early integration feedback.

## 6. Stacked Pull Requests

Each PR is tested against its configured base branch.

For a stack such as:

```text
main <- pass-03 <- pass-04
```

- the child PR tests against its parent branch;
- merging or retargeting the parent triggers fresh validation;
- the workflow does not force every stacked PR to compare directly with `main`;
- auto-merge is not enabled while a PR remains a draft;
- branch cleanup occurs only after dependent PRs are retargeted or merged.

## 7. Permissions and Supply-Chain Security

All workflows use the smallest practical permissions.

Default:

```yaml
permissions:
  contents: read
```

Additional permissions are introduced only when a specific documented step requires them.

Workflows must:

- set `persist-credentials: false` on checkout;
- avoid printing environment variables or tokens;
- avoid uploading the whole workspace unnecessarily;
- avoid `pull_request_target` for untrusted PR code;
- avoid write access, commit creation, PR mutation, and approval actions;
- avoid exposing repository secrets to forked PR code.

External Actions must be pinned to full immutable commit SHAs.

Readable comments preserve the corresponding release version:

```yaml
uses: actions/checkout@<full-commit-sha> # v4.x
```

The policy checker maintains a small explicit allowlist rather than trusting arbitrary Marketplace actions.

## 8. Toolchain Consistency

Workflow versions must match repository declarations:

- Node.js: 22;
- Python: 3.12;
- pnpm: 11.2.2;
- lockfile installation: frozen;
- root verification: `pnpm run verify`;
- browser-extension verification: `pnpm run verify`.

Caching may be introduced only if:

- cache keys include the relevant lockfile;
- no build outputs or credentials are shared unsafely;
- cache restoration cannot bypass lockfile installation or validation;
- Linux and Windows cache scopes remain appropriate.

## 9. Failure Handling

### Required CI

`required-ci` reports each mandatory dependency result and fails closed.

It must not silently pass when:

- a dependency job fails;
- a dependency job times out;
- a dependency job is cancelled;
- a mandatory job is unexpectedly skipped.

### Policy checks

Policy failures identify:

- affected file;
- workflow and job;
- rule identifier;
- expected state;
- remediation guidance.

### External security checks

Network or registry failures are recorded as warnings during the initial rollout. Confirmed vulnerability findings remain visible in the workflow summary and repository security tooling.

### No mutation

No workflow in this design changes repository files, pushes commits, merges PRs, creates approvals, or modifies branches.

## 10. Rollout Plan

Implementation occurs on a dedicated branch:

```text
github-workflow-hardening
```

Rollout order:

1. Add the policy checker and its tests.
2. Update `verify.yml` with stable jobs, concurrency, pinned Actions, and `required-ci`.
3. Refine `workspace-tools.yml` without making it globally required.
4. Add `security.yml`.
5. Add `.github/dependabot.yml`.
6. Validate YAML and local policy checks.
7. Open a draft PR.
8. Confirm the PR produces a passing `required-ci`.
9. Merge the hardening PR using squash merge.
10. Update the `main` ruleset to require only `required-ci`.
11. Remove old individual required-check names after the new gate is proven stable.

The existing ruleset must not be changed to require `required-ci` before GitHub has observed that check on a real PR.

## 11. Validation Strategy

The implementation must validate:

- workflow YAML syntax;
- Dependabot schema structure;
- event triggers;
- permissions;
- immutable Action references;
- checkout credential persistence;
- concurrency grouping;
- job timeouts;
- stable check names;
- `required-ci` fail-closed behavior;
- Linux compatibility;
- Windows compatibility;
- root verification;
- browser-extension verification;
- draft PR behavior;
- stacked PR behavior;
- path-filtered specialist workflow behavior;
- secret-free logs and summaries.

Where feasible, the policy checker itself must have tests using valid and intentionally invalid workflow fixtures.

## 12. Ruleset Integration

After the workflow is merged and observed, the `main` ruleset should require:

```text
required-ci
```

It should no longer depend directly on:

```text
verify (ubuntu-latest)
verify (windows-latest)
```

This creates a stable protection boundary while allowing internal CI job names and topology to evolve.

The ruleset continues to require:

- a pull request;
- resolved review conversations;
- an up-to-date branch;
- linear history;
- blocked force pushes;
- blocked deletion of `main`.

## 13. Non-Goals

This change does not:

- alter application runtime behavior;
- change product features;
- introduce deployment or release publishing;
- grant Actions write permissions;
- auto-merge draft PRs;
- automatically resolve security vulnerabilities;
- replace GitHub CodeQL, secret scanning, or push protection;
- make network-dependent vulnerability services part of the initial merge gate;
- remove manual authenticated-browser smoke testing.

## 14. Success Criteria

The workflow hardening is complete when:

- every PR receives exactly one dependable `required-ci` gate;
- obsolete runs cancel after a new commit to the same PR;
- pushes to `main` retain reliable verification history;
- Linux and Windows verification remain complete;
- root and browser-extension verification both run;
- targeted specialist checks run only when relevant;
- workflow-policy failures are precise and actionable;
- workflows use read-only permissions;
- checkout credentials are not persisted;
- external Actions are pinned to immutable SHAs;
- Dependabot creates grouped, manageable update PRs;
- scheduled security scans run without blocking normal work due solely to external outages;
- stacked PR behavior remains correct;
- the repository ruleset needs only the stable `required-ci` check.

## 15. Implementation Boundary

Implementation may begin only after this specification is reviewed. The next artifact is a detailed, file-by-file implementation plan created with test-first sequencing and explicit verification checkpoints.
