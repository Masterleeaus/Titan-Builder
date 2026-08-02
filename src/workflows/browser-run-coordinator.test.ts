import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ProjectRecord } from '../projects/registry.ts';
import {
  createBrowserRunCoordinator,
  type BrowserRunBackgroundError,
} from './browser-run-coordinator.ts';
import {
  createBrowserRunStore,
  type BrowserRunEventInput,
  type BrowserRunStore,
} from './browser-run-store.ts';

async function waitForBackgroundWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

test('a failure while recording preparation failure is reported without an unhandled rejection', async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-run-failure-boundary-'));
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const baseStore = createBrowserRunStore({ persistence: 'memory' });
  const preparationError = new Error('model preparation failed');
  const recordingError = new Error('failure event persistence unavailable');
  const store: BrowserRunStore = {
    ...baseStore,
    async appendEvent(runId: string, event: BrowserRunEventInput) {
      if (event.type === 'failure') throw recordingError;
      return baseStore.appendEvent(runId, event);
    },
  };
  const project: ProjectRecord = {
    id: 'project-1234567890abcdef',
    name: 'Failure boundary fixture',
    root: projectRoot,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const unhandledRejections: unknown[] = [];
  const reportedErrors: BrowserRunBackgroundError[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason);
  };
  process.on('unhandledRejection', onUnhandledRejection);
  t.after(() => {
    process.off('unhandledRejection', onUnhandledRejection);
  });

  const coordinator = createBrowserRunCoordinator({
    store,
    resolveProject: async () => project,
    submitAndWait: async () => {
      throw preparationError;
    },
    onBackgroundError: async (event) => {
      reportedErrors.push(event);
      throw new Error('custom background reporter unavailable');
    },
  });

  const run = await coordinator.create({
    mode: 'ask',
    projectId: project.id,
    prompt: 'Trigger preparation failure',
  });
  await waitForBackgroundWork();

  assert.deepEqual(unhandledRejections, []);
  assert.equal(reportedErrors.length, 1);
  assert.equal(reportedErrors[0]?.runId, run.id);
  assert.equal(reportedErrors[0]?.phase, 'preparation_failure_recording');
  assert.equal(reportedErrors[0]?.preparationError, preparationError);
  assert.equal(reportedErrors[0]?.recordingError, recordingError);
});
