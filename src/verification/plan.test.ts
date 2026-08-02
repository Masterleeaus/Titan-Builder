import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVerificationPlan } from './plan.ts';

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
