import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVerificationPlan } from './plan.ts';
import { runRecruiterBrowserFirstDemo } from '../../scripts/recruiter-browser-first-demo.ts';


test('quick profile chooses the smallest focused test script', () => {
  assert.deepEqual(
    buildVerificationPlan({
      packageManager: 'pnpm',
      scripts: {
        test: 'vitest',
        'test:node': 'node --test',
        build: 'tsc',
      },
      profile: 'quick',
    }),
    [{ action: 'RUN_TOOL', tool: 'pnpm.run', args: ['test:node'] }],
  );
});

test('standard profile orders typecheck, tests, and build without duplicates', () => {
  assert.deepEqual(
    buildVerificationPlan({
      packageManager: 'npm',
      scripts: {
        build: 'tsc',
        typecheck: 'tsc --noEmit',
        test: 'vitest',
        lint: 'eslint .',
      },
      profile: 'standard',
    }),
    [
      { action: 'RUN_TOOL', tool: 'npm.run', args: ['typecheck'] },
      { action: 'RUN_TOOL', tool: 'npm.run', args: ['test'] },
      { action: 'RUN_TOOL', tool: 'npm.run', args: ['build'] },
    ],
  );
});

test('full profile prefers the repository verify script', () => {
  assert.deepEqual(
    buildVerificationPlan({
      packageManager: 'pnpm',
      scripts: {
        verify: 'pnpm run typecheck && pnpm run test',
        test: 'vitest',
        build: 'tsc',
      },
      profile: 'full',
    }),
    [{ action: 'RUN_TOOL', tool: 'pnpm.run', args: ['verify'] }],
  );
});

test('unsupported package managers and projects without verification scripts return no operations', () => {
  assert.deepEqual(
    buildVerificationPlan({ packageManager: 'yarn', scripts: { test: 'jest' }, profile: 'standard' }),
    [],
  );
  assert.deepEqual(
    buildVerificationPlan({ packageManager: 'npm', scripts: { dev: 'vite' }, profile: 'standard' }),
    [],
  );
});
test('fixture recruiter demo proves authority, approval, and verification boundaries', async () => {
  const result = await runRecruiterBrowserFirstDemo({ emit: false });

  assert.equal(result.fixture, 'docs/recruiter-fixtures/browser-first');
  assert.equal(result.projectAuthority.identityKind, 'filesystem');
  assert.equal(result.projectAuthority.escapeRejected, true);
  assert.equal(result.approval.previewMismatchRejected, true);
  assert.equal(result.approval.replayRejected, true);
  assert.equal(result.execution.dryRun, true);
  assert.equal(result.execution.applied, false);
  assert.equal(result.verification.selectedOperation, 'pnpm run verify');
  assert.equal(result.verification.passed, true);
  assert.equal(result.provider, 'not invoked');
  assert.equal(result.browserSession, 'not invoked');
  assert.equal(result.productionReadiness, 'not assessed');
});
