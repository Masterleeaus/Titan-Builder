# OB-009 — Package Script and Install Lifecycle Risk

- Severity: High
- Branch: `agent/titan-builder-repairs-pass2`
- Status: VERIFIED
- Source commit before squash merge: `1683f2ab81d2ed4ac36b53855ac89a4e7ce86677`
- Merged main commit: `9e9eb58be03e65018cf5ad5544f1acff6172705d`
- Continuation verification commit: `6f88f036ff908cccc4267d58946f154c572dbb16`
- Artifact SHA-256: `9b37e8aefbe09e15e7e510c4e5d4fc4d6b2cc2ddeeb85bfeb9575136a7a97308`
- Offline applicator run: `30724994166`
- Offline applicator job: `91434886053`
- Full verification run: `30725094613`
- Full verification job: `91435158403`

## Confirmed defect

Package-manager scripts and installs were presented as safer than their actual execution capability:

1. `npm test`, `npm run`, `pnpm test`, and `pnpm run` execute arbitrary project-controlled commands from `package.json`.
2. Dependency installation can execute package lifecycle hooks unless scripts are explicitly disabled.
3. Install plans were not bound to the exact package manifest and lockfile reviewed during preview.
4. A package manifest or lockfile could change between approval and execution without invalidating the plan.

## Implemented repair

### Risk classification

- Added explicit `ARBITRARY_EXECUTION` risk for npm and pnpm package scripts.
- Added explicit `NETWORK_WRITE` risk for dependency installation.
- Both risks require per-operation approval and are included in risk summaries.
- Removed package scripts from the safe-execution category regardless of script name.

### Safe-default installs

- `npm.install` resolves to `npm ci --ignore-scripts`.
- `pnpm.install` resolves to `pnpm install --frozen-lockfile --ignore-scripts`.
- npm installation requires `package.json` and `package-lock.json`.
- pnpm installation requires `package.json` and `pnpm-lock.yaml`.
- Relevant optional workspace and package-manager configuration files are included in the preview boundary.

### Preview and execution binding

- Package manifests, lockfiles, workspace configuration, and relevant `.npmrc` files are hashed during planning.
- Required input files must exist before an install can be approved.
- Every captured input is revalidated immediately before execution.
- Changes to a script definition, lockfile, or package-manager configuration invalidate the approved plan.

### Documentation and prompt safety

- Agent instructions no longer describe package scripts as safe execution.
- README explains that package scripts are arbitrary project code and that installs disable lifecycle scripts by default.

## Failure-first coverage

- npm and pnpm test/run operations are `ARBITRARY_EXECUTION`.
- package scripts require explicit approval.
- npm install uses `ci --ignore-scripts` and requires `package-lock.json`.
- pnpm install uses `--frozen-lockfile --ignore-scripts` and requires `pnpm-lock.yaml`.
- a missing required lockfile blocks planning.
- a changed package manifest invalidates an approved script plan before execution.
- package-input preconditions participate in transactional execution.

## Green evidence

The guarded applicator passed:

- Artifact checksum and exact seven-path allowlist.
- 128/128 dependency-free Node tests.
- Manifest V3 extension integrity.
- Commit and push before the squash merge.

The permanent read-only GitHub verification pipeline passed on draft PR #2:

- TypeScript typecheck.
- 128/128 Node tests.
- 7/7 dependency-backed integration tests, including stale-manifest rejection and required-lockfile previews.
- Production build.
- CLI smoke test.
- Manifest V3 extension integrity.

The acceptance criteria are satisfied. Package scripts are treated as arbitrary project code, installs are lifecycle-disabled and lockfile-enforced by default, and reviewed package inputs are bound to execution through precondition hashes.
