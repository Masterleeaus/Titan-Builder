import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { planOperations, executePlannedOperations } from '../src/operations/index.ts';
import { createOperationApprovalStore } from '../src/server/operation-approvals.ts';
import { captureRepositoryIdentity } from '../src/security/repository-identity.ts';
import { resolveProjectPath } from '../src/security/project-path.ts';
import { buildVerificationPlan } from '../src/verification/plan.ts';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const FIXTURE_SOURCE = path.join(
  REPOSITORY_ROOT,
  'docs',
  'recruiter-fixtures',
  'browser-first',
);

const DEMO_OUTPUT = '# Titan Browser-First Fixture\n\nThis file was created only after the reviewed operation was approved.\n';

export interface RecruiterDemoResult {
  fixture: string;
  projectAuthority: {
    identityKind: string;
    inProjectPath: string;
    escapeRejected: boolean;
  };
  approval: {
    reviewedOperation: string;
    riskSummary: Record<string, number>;
    previewMismatchRejected: boolean;
    replayRejected: boolean;
  };
  verification: {
    selectedOperation: string;
    passed: boolean;
  };
  provider: 'not invoked';
  browserSession: 'not invoked';
  productionReadiness: 'not assessed';
}

export async function runRecruiterBrowserFirstDemo(
  options: { emit?: boolean } = {},
): Promise<RecruiterDemoResult> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'titan-browser-first-'));
  const projectRoot = path.join(workspace, 'fixture');

  try {
    await cp(FIXTURE_SOURCE, projectRoot, { recursive: true });

    const repositoryIdentity = await captureRepositoryIdentity(projectRoot);
    assert.equal(repositoryIdentity.kind, 'filesystem');

    const packagePath = await resolveProjectPath(projectRoot, 'package.json', {
      requireExisting: true,
      expectedType: 'file',
    });
    assert.equal(path.relative(projectRoot, packagePath), 'package.json');

    let escapeRejected = false;
    try {
      await resolveProjectPath(projectRoot, '../outside.txt');
    } catch {
      escapeRejected = true;
    }
    assert.equal(escapeRejected, true);

    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    const verificationOperations = buildVerificationPlan({
      packageManager: 'pnpm',
      scripts: packageJson.scripts,
      profile: 'full',
    });
    assert.deepEqual(verificationOperations, [
      { action: 'RUN_TOOL', tool: 'pnpm.run', args: ['verify'] },
    ]);

    const plans = await planOperations(
      [
        {
          action: 'CREATE_FILE',
          path: 'demo-output.md',
          content: DEMO_OUTPUT,
        },
      ],
      projectRoot,
    );
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.operation.path, 'demo-output.md');
    await assert.rejects(stat(path.join(projectRoot, 'demo-output.md')));

    const runId = 'recruiter-browser-first-fixture';
    const conversationId = 'fixture-local-session';
    const selectedOperationIds = ['op-1'];
    const approvalStore = createOperationApprovalStore();
    const issued = approvalStore.issue({
      projectRoot,
      repositoryIdentity,
      plans,
      runId,
      conversationId,
      selectedOperationIds,
    });
    const expectation = {
      projectRoot,
      repositoryIdentity,
      runId,
      conversationId,
      selectedOperationIds,
    };
    const inspection = approvalStore.inspect(issued.token, expectation);
    assert.equal(inspection.plans[0]?.operation.path, 'demo-output.md');

    let previewMismatchRejected = false;
    try {
      approvalStore.inspect(issued.token, {
        ...expectation,
        previewRevision: 'stale-preview',
      });
    } catch {
      previewMismatchRejected = true;
    }
    assert.equal(previewMismatchRejected, true);

    const approvedPlans = approvalStore.consume(issued.token, expectation);
    await executePlannedOperations(approvedPlans, projectRoot, {
      conversationId,
    });
    assert.equal(await readFile(path.join(projectRoot, 'demo-output.md'), 'utf8'), DEMO_OUTPUT);

    let replayRejected = false;
    try {
      approvalStore.consume(issued.token, expectation);
    } catch {
      replayRejected = true;
    }
    assert.equal(replayRejected, true);

    const verificationPlans = await planOperations(
      verificationOperations,
      projectRoot,
    );
    await executePlannedOperations(verificationPlans, projectRoot, {
      conversationId,
    });

    const result: RecruiterDemoResult = {
      fixture: 'docs/recruiter-fixtures/browser-first',
      projectAuthority: {
        identityKind: repositoryIdentity.kind,
        inProjectPath: 'package.json',
        escapeRejected,
      },
      approval: {
        reviewedOperation: 'CREATE_FILE demo-output.md',
        riskSummary: issued.riskSummary,
        previewMismatchRejected,
        replayRejected,
      },
      verification: {
        selectedOperation: 'pnpm run verify',
        passed: true,
      },
      provider: 'not invoked',
      browserSession: 'not invoked',
      productionReadiness: 'not assessed',
    };

    if (options.emit !== false) {
      console.log(JSON.stringify(result, null, 2));
    }
    return result;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === SCRIPT_PATH) {
  await runRecruiterBrowserFirstDemo();
}
