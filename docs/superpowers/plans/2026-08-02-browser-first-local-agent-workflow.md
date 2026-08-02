# Browser-First Local Agent Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user perform complete OpenBrowser ask and agent workflows from the Chrome side panel while the installed local CLI/bridge remains the authoritative engine for project context, parsing, diff generation, approvals, file operations, verification, and audit history.

**Architecture:** Refactor the agent workflow currently embedded in `src/index.ts` into reusable prepare/apply services. Keep the root Node process on `127.0.0.1:5000` as the only authoritative execution service, expose narrowly scoped browser-workflow endpoints authenticated with `BRIDGE_BROWSER_TOKEN`, and add a Work view to the extension side panel. The extension remains a thin UI and provider automation client; it never receives `BRIDGE_TOKEN`, reads the filesystem directly, or applies operations itself.

**Tech Stack:** Node.js 22+, TypeScript, Fastify, Chrome Manifest V3, browser JavaScript modules, Server-Sent Events over authenticated `fetch`, pnpm 11.2.2, existing OpenBrowser operation planner/executor, existing project registry, existing prompt session transport.

## Global Constraints

- Work on a fresh implementation branch created from current `main`; never implement directly on `main`.
- Preserve all existing CLI commands and terminal behavior.
- Preserve current provider support and the existing prompt-delivery pipeline.
- Keep `BRIDGE_TOKEN` out of Chrome storage and extension code.
- Authenticate all browser workflow endpoints with `BRIDGE_BROWSER_TOKEN` and an allowed extension origin.
- The extension must not read, write, delete, rename, or execute local files directly.
- Every write, destructive, arbitrary-execution, network-write, or publish operation must remain visibly reviewable before execution.
- Never auto-approve or silently apply an agent response.
- Revalidate the selected operations against the current filesystem immediately before applying them.
- Use the root bridge on `127.0.0.1:5000` as the authoritative workflow service.
- Do not create a third execution engine or duplicate operation planning inside `browser-extension/`.
- Do not route browser-first file approvals through the optional workspace companion on port `5010`.
- Keep the existing workspace companion isolated to analysis/indexing until a separate consolidation plan is approved.
- Do not intercept every message typed into ChatGPT's native composer. Coding runs begin from the OpenBrowser side panel so ordinary ChatGPT conversations remain ordinary conversations.
- Use TDD for every task and commit each independently testable deliverable.

---

## Target User Experience

1. OpenBrowser Local Agent starts automatically when the user signs in, or is started manually with `openbrowser service start`.
2. The user opens ChatGPT in Chrome and opens the OpenBrowser side panel.
3. The user selects a registered local project.
4. The user chooses **Ask** or **Agent**.
5. The user enters a task, optional `@file` or `@folder` references, context budget, provider, and verification profile.
6. The side panel starts the run through the local bridge.
7. ChatGPT receives the generated prompt through the existing extension provider automation.
8. Ask mode displays the answer in the side panel and in the ChatGPT conversation.
9. Agent mode displays parsed operations, risk labels, unified diffs, and changed-file summaries.
10. The user selects allowed operations, explicitly confirms high-risk operations, then confirms the final batch.
11. The local service re-plans the selected operations. If the working tree changed, the preview expires and the user must review the replacement preview.
12. The local service applies the approved operations, optionally runs verification, and reports the result in the side panel.
13. The run remains visible after the side panel closes or Chrome restarts.

## Explicit Non-Goals

- No unattended autonomous file changes.
- No automatic shell access from the extension.
- No browser storage of project file contents, full diffs, control tokens, or approval capabilities after expiry.
- No replacement of the existing ChatGPT page with a custom chat application.
- No dependency on a cloud backend.
- No requirement to keep a visible PowerShell window open after the background-service pass is implemented.

---

## Browser Workflow API Contract

All routes below require the browser token and the pinned or configured extension origin.

```ts
export type BrowserRunMode = 'ask' | 'agent';

export type BrowserRunStatus =
  | 'queued'
  | 'building_context'
  | 'waiting_for_model'
  | 'validating_response'
  | 'awaiting_approval'
  | 'ready_to_apply'
  | 'applying'
  | 'verifying'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export interface CreateBrowserRunRequest {
  mode: BrowserRunMode;
  projectId: string;
  prompt: string;
  contextRefs?: string[];
  contextBudget?: number;
  provider?: 'auto' | 'chatgpt' | 'claude' | 'gemini' | 'deepseek' | 'perplexity' | 'glm' | 'grok';
  verificationProfile?: 'quick' | 'standard' | 'full';
}

export interface BrowserOperationPreview {
  id: string;
  action: string;
  path?: string;
  risk: string;
  summary: string;
  diff: string;
  requiresExplicitApproval: boolean;
}

export interface BrowserRunSnapshot {
  id: string;
  mode: BrowserRunMode;
  status: BrowserRunStatus;
  projectId: string;
  projectName: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
  responseText?: string;
  operations?: BrowserOperationPreview[];
  previewRevision?: string;
  verification?: {
    profile: 'quick' | 'standard' | 'full';
    status: 'pending' | 'running' | 'passed' | 'failed';
    summary?: string;
  };
  error?: string;
}
```

Endpoints:

```text
POST /workspace/runs
GET  /workspace/runs/:runId
GET  /workspace/runs/:runId/events
POST /workspace/runs/:runId/approve
POST /workspace/runs/:runId/apply
POST /workspace/runs/:runId/reject
POST /workspace/runs/:runId/cancel
GET  /workspace/runs?projectId=<id>&limit=<n>
```

Approval is intentionally two-stage:

```text
Review operations and choose a subset
        ↓
POST /workspace/runs/:id/approve
        ↓
Server re-plans and returns a short-lived one-time approval token
        ↓
User confirms final batch
        ↓
POST /workspace/runs/:id/apply
```

---

## File Structure

### Create

- `src/workflows/browser-run-types.ts` — shared browser-run types and serializers.
- `src/workflows/agent-preparation.ts` — build context, submit model request, retry capture, parse response, and plan operations without applying.
- `src/workflows/agent-application.ts` — re-plan selected operations, execute, verify, and return structured results.
- `src/workflows/browser-run-store.ts` — persistent run state with safe transitions and bounded retention.
- `src/workflows/browser-run-coordinator.ts` — asynchronous run state machine used by HTTP routes.
- `src/server/browser-workflow-routes.ts` — browser-scoped Fastify routes.
- `src/service/service-manager.ts` — detached process lifecycle, PID metadata, logs, and stale-process recovery.
- `src/service/service-entry.ts` — long-running local bridge entry point.
- `browser-extension/src/agent-workspace.js` — side-panel controller for run creation, status, streaming, approvals, and apply.
- `browser-extension/src/agent-workspace.test.mjs` — browser UI state and payload tests.
- `src/workflows/browser-run-store.test.ts` — transition and persistence tests.
- `src/workflows/agent-preparation.test.ts` — reusable preparation workflow tests.
- `src/workflows/agent-application.test.ts` — selection, re-plan, and execution tests.
- `src/server/browser-workflow.integration.test.ts` — authenticated API integration tests.
- `src/service/service-manager.test.ts` — service lifecycle tests.

### Modify

- `src/index.ts` — replace embedded agent logic with shared workflow calls; add `service` commands.
- `src/server/index.ts` — register browser workflow routes and inject workflow dependencies.
- `src/server/security.ts` — classify `/workspace/runs` as a dedicated browser-workflow scope.
- `src/server/operation-approvals.ts` — bind approval capabilities to run ID, project root, preview revision, selected operations, and expiry.
- `src/projects/registry.ts` — resolve a registered project by ID and reject unregistered roots.
- `src/client/bridge-client.ts` — retain existing CLI transport and add typed run helpers where shared by tests.
- `src/verification/index.ts` — expose a structured verification result instead of terminal-only output.
- `browser-extension/src/background.js` — relay authenticated run events and requests without exposing control credentials.
- `browser-extension/src/sidepanel.html` — add the Work view and review/apply interface.
- `browser-extension/src/sidepanel.js` — integrate the agent-workspace controller without duplicating workflow logic.
- `browser-extension/src/sidepanel.css` — add progress, diff, risk, approval, and verification presentation.
- `browser-extension/src/bridge-config.js` — retain browser-token-only settings.
- `browser-extension/src/sidepanel-integration.test.mjs` — cover the new Work tab wiring.
- `browser-extension/src/provider-routing-security.test.mjs` — prove the extension still cannot use the control token.
- `src/server/security.test.ts` — cover the new route scope.
- `src/server/operation-approvals.test.ts` — cover run-bound, revision-bound, one-time approvals.
- `src/server/workflow.integration.ts` — preserve terminal workflow compatibility.
- `package.json` — include new tests and service commands.
- `scripts/install-windows.ps1` — optionally register background startup after explicit consent.
- `README.md` — document browser-first and terminal workflows.

---

### Task 1: Define the Browser Run State Machine

**Files:**
- Create: `src/workflows/browser-run-types.ts`
- Create: `src/workflows/browser-run-store.ts`
- Create: `src/workflows/browser-run-store.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `BrowserRunStatus`, `BrowserRunSnapshot`, `BrowserRunRecord`, `BrowserRunStore`.
- Produces: `createBrowserRunStore(options)` with `create`, `get`, `list`, `transition`, and `prune`.
- Consumes: registered project IDs only; no raw browser-supplied filesystem roots.

- [ ] **Step 1: Write transition tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserRunStore } from './browser-run-store.js';

test('agent run cannot skip from waiting_for_model to applying', async () => {
  const store = createBrowserRunStore({ persistence: 'memory' });
  const run = await store.create({ mode: 'agent', projectId: 'project-1', prompt: 'change x' });
  await store.transition(run.id, 'building_context');
  await store.transition(run.id, 'waiting_for_model');
  await assert.rejects(() => store.transition(run.id, 'applying'), /Invalid run transition/);
});

test('approval revision is invalidated when preview changes', async () => {
  const store = createBrowserRunStore({ persistence: 'memory' });
  const run = await store.create({ mode: 'agent', projectId: 'project-1', prompt: 'change x' });
  await store.setPreview(run.id, [{ id: 'op-1', action: 'EDIT_FILE', risk: 'WRITE', diff: 'diff' }]);
  const first = await store.get(run.id);
  await store.setPreview(run.id, [{ id: 'op-2', action: 'EDIT_FILE', risk: 'WRITE', diff: 'new diff' }]);
  const second = await store.get(run.id);
  assert.notEqual(first.previewRevision, second.previewRevision);
});
```

- [ ] **Step 2: Run the tests and confirm failure**

```bash
node --experimental-strip-types --test src/workflows/browser-run-store.test.ts
```

Expected: failure because the store does not exist.

- [ ] **Step 3: Implement explicit transitions**

```ts
const ALLOWED_TRANSITIONS: Record<BrowserRunStatus, BrowserRunStatus[]> = {
  queued: ['building_context', 'cancelled', 'failed'],
  building_context: ['waiting_for_model', 'cancelled', 'failed'],
  waiting_for_model: ['validating_response', 'cancelled', 'failed'],
  validating_response: ['awaiting_approval', 'completed', 'failed'],
  awaiting_approval: ['ready_to_apply', 'rejected', 'cancelled', 'failed'],
  ready_to_apply: ['applying', 'rejected', 'cancelled', 'failed'],
  applying: ['verifying', 'completed', 'failed'],
  verifying: ['completed', 'failed'],
  completed: [],
  rejected: [],
  cancelled: [],
  failed: [],
};
```

Persist records under `~/.openbrowser/runs/`, write atomically through a temporary file plus rename, and retain at most 100 completed records or 30 days, whichever is smaller.

- [ ] **Step 4: Run the focused tests**

```bash
node --experimental-strip-types --test src/workflows/browser-run-store.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/browser-run-types.ts src/workflows/browser-run-store.ts src/workflows/browser-run-store.test.ts package.json
git commit -m "feat: add browser agent run state machine"
```

---

### Task 2: Extract Reusable Agent Preparation from the CLI

**Files:**
- Create: `src/workflows/agent-preparation.ts`
- Create: `src/workflows/agent-preparation.test.ts`
- Modify: `src/index.ts`
- Modify: `src/prompts/system.ts`
- Modify: `src/parser/index.ts`

**Interfaces:**
- Produces: `prepareAgentRun(input, dependencies): Promise<PreparedAgentRun>`.
- Produces: `runAskWorkflow(input, dependencies): Promise<AskWorkflowResult>`.
- `PreparedAgentRun` contains the original validated operations and immutable operation previews, but performs no writes.

```ts
export interface PrepareAgentRunInput {
  projectRoot: string;
  task: string;
  contextRefs: string[];
  contextBudget?: number;
  conversationId: string;
}

export interface PreparedAgentRun {
  conversationId: string;
  rawResponse: string;
  operations: FileOperation[];
  previews: PlannedOperation[];
}
```

- [ ] **Step 1: Write a preparation test using injected transport**

```ts
test('prepareAgentRun parses and plans without executing', async () => {
  let executed = false;
  const result = await prepareAgentRun(
    { projectRoot, task: 'create note', contextRefs: [], conversationId: 'conversation-1' },
    {
      submitAndWait: async () => JSON.stringify({
        conversationId: 'conversation-1',
        operations: [{ action: 'CREATE_FILE', path: 'note.txt', content: 'hello' }],
      }),
      executePlans: async () => { executed = true; return []; },
    },
  );
  assert.equal(result.previews.length, 1);
  assert.equal(executed, false);
});
```

- [ ] **Step 2: Run the test and confirm failure**

```bash
node --experimental-strip-types --test src/workflows/agent-preparation.test.ts
```

- [ ] **Step 3: Move, do not copy, the reusable logic from `runAgent`**

Move these responsibilities out of `src/index.ts`:

- project summary and budgeted context construction;
- project memory attachment;
- system prompt generation;
- up to three browser-capture or validation attempts;
- response parsing and conversation ID validation;
- operation planning and risk metadata generation.

Keep terminal formatting, spinner output, and `confirm()` inside `src/index.ts` as the CLI adapter.

- [ ] **Step 4: Prove CLI parity**

```bash
pnpm run test:node
pnpm run test:integration
pnpm run typecheck
```

Expected: existing ask and agent tests remain green and no file is applied during preparation tests.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/agent-preparation.ts src/workflows/agent-preparation.test.ts src/index.ts src/prompts/system.ts src/parser/index.ts
git commit -m "refactor: extract reusable agent preparation"
```

---

### Task 3: Extract Reusable Apply and Verification Logic

**Files:**
- Create: `src/workflows/agent-application.ts`
- Create: `src/workflows/agent-application.test.ts`
- Modify: `src/index.ts`
- Modify: `src/verification/index.ts`
- Modify: `src/server/operation-approvals.ts`

**Interfaces:**
- Produces: `prepareSelectedApproval(preparedRun, selectedOperationIds, projectRoot)`.
- Produces: `applyApprovedAgentRun(input, dependencies)`.
- Approval capabilities are one-time, short-lived, and bound to run ID, project root, preview revision, and selected operation IDs.

```ts
export interface ApplyApprovedAgentRunInput {
  runId: string;
  projectRoot: string;
  conversationId: string;
  selectedOperations: FileOperation[];
  verificationProfile?: 'quick' | 'standard' | 'full';
}
```

- [ ] **Step 1: Write stale-preview and one-time-token tests**

```ts
test('apply rejects when the filesystem no longer matches the preview', async () => {
  const prepared = await prepareFixtureRun(projectRoot);
  await fs.writeFile(path.join(projectRoot, 'target.txt'), 'changed elsewhere');
  await assert.rejects(
    () => prepareSelectedApproval(prepared, ['op-1'], projectRoot),
    /Preview is stale/,
  );
});

test('approval token can be consumed once', async () => {
  const approval = approvals.issue(runBoundApprovalFixture);
  approvals.consume(approval.token, runBoundApprovalFixture);
  assert.throws(() => approvals.consume(approval.token, runBoundApprovalFixture), /already used|invalid/i);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
node --experimental-strip-types --test src/workflows/agent-application.test.ts src/server/operation-approvals.test.ts
```

- [ ] **Step 3: Implement re-plan-before-apply**

The apply workflow must:

1. Resolve the registered project root again.
2. Re-plan only the selected operations.
3. Compare the re-planned digest to the reviewed preview revision.
4. Reject with a structured `STALE_PREVIEW` error when any diff changed.
5. Consume the one-time approval token.
6. Execute through `executePlannedOperations`.
7. Run the selected verification profile.
8. Return changed-file and verification summaries without terminal formatting.

- [ ] **Step 4: Replace the CLI execution block with the shared apply service**

The CLI must retain its current per-risk prompts and final `[y/N]` confirmation, then call the same apply function used by the browser workflow.

Run:

```bash
pnpm run test:node
pnpm run test:integration
pnpm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/workflows/agent-application.ts src/workflows/agent-application.test.ts src/index.ts src/verification/index.ts src/server/operation-approvals.ts src/server/operation-approvals.test.ts
git commit -m "refactor: share approved agent application workflow"
```

---

### Task 4: Add Registered-Project Browser Workflow Routes

**Files:**
- Create: `src/workflows/browser-run-coordinator.ts`
- Create: `src/server/browser-workflow-routes.ts`
- Create: `src/server/browser-workflow.integration.test.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/security.ts`
- Modify: `src/server/security.test.ts`
- Modify: `src/projects/registry.ts`

**Interfaces:**
- Consumes: `prepareAgentRun`, `runAskWorkflow`, `prepareSelectedApproval`, `applyApprovedAgentRun`, and `BrowserRunStore`.
- Produces: the Browser Workflow API contract defined above.
- Produces: `getProjectById(projectId)` that returns only registered canonical roots.

- [ ] **Step 1: Write authentication and project-boundary tests**

```ts
test('browser token can create a workspace run but cannot call operations/apply', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/workspace/runs',
    headers: browserHeaders,
    payload: { mode: 'ask', projectId, prompt: 'Explain this project' },
  });
  assert.equal(created.statusCode, 202);

  const forbidden = await app.inject({
    method: 'POST',
    url: '/operations/apply',
    headers: browserHeaders,
    payload: { approvalToken: 'x' },
  });
  assert.equal(forbidden.statusCode, 401);
});

test('browser cannot submit an arbitrary filesystem root', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/workspace/runs',
    headers: browserHeaders,
    payload: { mode: 'agent', projectId: 'C:\\Windows', prompt: 'edit files' },
  });
  assert.equal(response.statusCode, 404);
});
```

- [ ] **Step 2: Add a dedicated security scope**

```ts
export type BridgeRouteScope = 'public' | 'browser' | 'browser-workflow' | 'control' | 'shared';
```

`browser-workflow` accepts only the browser principal from an allowed extension origin. It does not grant access to `/session/*` or `/operations/*`.

- [ ] **Step 3: Register routes with dependency injection**

```ts
await registerBrowserWorkflowRoutes(app, {
  coordinator,
  projectRegistry,
});
```

Return `202 Accepted` immediately after creating a run. Execute preparation asynchronously and write every state transition to the run store.

- [ ] **Step 4: Run integration and security tests**

```bash
pnpm exec tsx --test src/server/browser-workflow.integration.test.ts
node --experimental-strip-types --test src/server/security.test.ts
pnpm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/workflows/browser-run-coordinator.ts src/server/browser-workflow-routes.ts src/server/browser-workflow.integration.test.ts src/server/index.ts src/server/security.ts src/server/security.test.ts src/projects/registry.ts
git commit -m "feat: add restricted browser agent workflow API"
```

---

### Task 5: Add the Chrome Work View

**Files:**
- Create: `browser-extension/src/agent-workspace.js`
- Create: `browser-extension/src/agent-workspace.test.mjs`
- Modify: `browser-extension/src/sidepanel.html`
- Modify: `browser-extension/src/sidepanel.js`
- Modify: `browser-extension/src/sidepanel.css`
- Modify: `browser-extension/src/sidepanel-integration.test.mjs`

**Interfaces:**
- Produces: `createAgentWorkspaceController({ bridgeRequest, storage, render })`.
- Consumes only browser-workflow endpoints through the background service worker.
- Does not contain parsing, planning, diff generation, verification, or file operation logic.

- [ ] **Step 1: Write UI payload and state tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCreateRunPayload, reduceRunViewState } from './agent-workspace.js';

test('agent payload requires an explicit registered project', () => {
  assert.throws(() => buildCreateRunPayload({ mode: 'agent', prompt: 'Fix it', projectId: '' }), /project/i);
});

test('awaiting approval exposes review controls but not a completed state', () => {
  const state = reduceRunViewState({}, {
    status: 'awaiting_approval',
    operations: [{ id: 'op-1', risk: 'WRITE', diff: 'diff', requiresExplicitApproval: true }],
  });
  assert.equal(state.showReview, true);
  assert.equal(state.showApply, false);
});
```

- [ ] **Step 2: Add a first-class Work tab**

The Work view contains:

- project selector;
- Ask/Agent segmented control;
- task composer;
- optional context references;
- context budget;
- provider selector;
- verification profile;
- Start run button;
- progress timeline;
- answer pane;
- operation review list;
- final approval controls;
- verification result;
- recent runs.

- [ ] **Step 3: Keep native ChatGPT visible**

The side panel sends the coding run through the bridge. The existing provider content script injects the model prompt into ChatGPT. Do not scrape or intercept unrelated user messages from the native composer.

- [ ] **Step 4: Run extension tests**

```bash
node --test browser-extension/src/agent-workspace.test.mjs browser-extension/src/sidepanel-integration.test.mjs
pnpm run check:extension
```

- [ ] **Step 5: Commit**

```bash
git add browser-extension/src/agent-workspace.js browser-extension/src/agent-workspace.test.mjs browser-extension/src/sidepanel.html browser-extension/src/sidepanel.js browser-extension/src/sidepanel.css browser-extension/src/sidepanel-integration.test.mjs
git commit -m "feat: add browser-first work view"
```

---

### Task 6: Relay Run Events Through the Extension Background Worker

**Files:**
- Modify: `browser-extension/src/background.js`
- Modify: `browser-extension/src/bridge-config.js`
- Create: `browser-extension/src/browser-run-events.test.mjs`
- Modify: `browser-extension/src/provider-routing-security.test.mjs`

**Interfaces:**
- Produces runtime messages:

```ts
{ type: 'OPENBROWSER_CREATE_RUN', payload }
{ type: 'OPENBROWSER_GET_RUN', runId }
{ type: 'OPENBROWSER_APPROVE_RUN', runId, previewRevision, selectedOperationIds }
{ type: 'OPENBROWSER_APPLY_RUN', runId, approvalToken }
{ type: 'OPENBROWSER_CANCEL_RUN', runId }
```

- Produces a long-lived side-panel port named `openbrowser-workspace-runs`.
- Uses authenticated `fetch` streaming because native `EventSource` cannot attach the bearer token.

- [ ] **Step 1: Write token-isolation tests**

```js
test('workflow requests use only the browser token', async () => {
  const headers = withBridgeAuth({ bridgeBrowserToken: 'browser-token' }, {});
  assert.equal(headers.Authorization, 'Bearer browser-token');
  assert.equal(JSON.stringify(headers).includes('BRIDGE_TOKEN'), false);
});
```

- [ ] **Step 2: Implement reconnectable authenticated event streaming**

The background worker must:

- abort the previous run stream when the active run changes;
- reconnect after service-worker suspension;
- request the latest snapshot before resuming events;
- ignore events for stale run IDs;
- never persist approval tokens after apply, reject, expiry, or panel close.

- [ ] **Step 3: Add polling fallback**

If streaming fails three times, poll `GET /workspace/runs/:id` every two seconds until a terminal state is reached. Stop polling when the side panel disconnects.

- [ ] **Step 4: Run security and event tests**

```bash
node --test browser-extension/src/browser-run-events.test.mjs browser-extension/src/provider-routing-security.test.mjs
pnpm run check:extension
```

- [ ] **Step 5: Commit**

```bash
git add browser-extension/src/background.js browser-extension/src/bridge-config.js browser-extension/src/browser-run-events.test.mjs browser-extension/src/provider-routing-security.test.mjs
git commit -m "feat: stream local agent runs to chrome"
```

---

### Task 7: Implement Two-Stage Browser Approval

**Files:**
- Modify: `browser-extension/src/agent-workspace.js`
- Modify: `browser-extension/src/sidepanel.html`
- Modify: `browser-extension/src/sidepanel.css`
- Modify: `browser-extension/src/agent-workspace.test.mjs`
- Modify: `src/server/browser-workflow.integration.test.ts`

**Interfaces:**
- Browser sends selected operation IDs and the exact `previewRevision`.
- Server returns a short-lived approval token and final summary.
- Browser requires a second explicit action to apply the batch.

- [ ] **Step 1: Test risk-gated selection**

```js
test('high-risk operation is unselected until separately approved', () => {
  const model = buildOperationSelection([
    { id: 'safe', risk: 'WRITE', requiresExplicitApproval: false },
    { id: 'danger', risk: 'DESTRUCTIVE', requiresExplicitApproval: true },
  ]);
  assert.equal(model.selected.has('safe'), true);
  assert.equal(model.selected.has('danger'), false);
});
```

- [ ] **Step 2: Render operation review cards**

Each card displays:

- operation action;
- path or command summary;
- risk label;
- unified diff;
- selected state;
- explicit high-risk confirmation control.

Never render operation content with `innerHTML`; use text nodes or `<pre>.textContent`.

- [ ] **Step 3: Implement stale-preview recovery**

When apply returns `409 STALE_PREVIEW`, clear the approval token, load the replacement preview, show `The project changed after this preview. Review the updated diff`, and require both approval stages again.

- [ ] **Step 4: Run browser and API integration tests**

```bash
node --test browser-extension/src/agent-workspace.test.mjs
pnpm exec tsx --test src/server/browser-workflow.integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add browser-extension/src/agent-workspace.js browser-extension/src/sidepanel.html browser-extension/src/sidepanel.css browser-extension/src/agent-workspace.test.mjs src/server/browser-workflow.integration.test.ts
git commit -m "feat: add browser diff review and approval"
```

---

### Task 8: Add an Opt-In Background Local Service

**Files:**
- Create: `src/service/service-entry.ts`
- Create: `src/service/service-manager.ts`
- Create: `src/service/service-manager.test.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `scripts/install-windows.ps1`

**Interfaces:**
- Produces CLI commands:

```text
openbrowser service start
openbrowser service stop
openbrowser service restart
openbrowser service status
openbrowser service logs
openbrowser service install --startup
openbrowser service uninstall --startup
```

- Stores runtime metadata under `~/.openbrowser/service.json`.
- Writes logs under `~/.openbrowser/logs/service.log`.

- [ ] **Step 1: Write lifecycle tests with a fake process adapter**

```ts
test('start does not create a second service when a healthy PID already exists', async () => {
  const processes = createFakeProcessAdapter({ 1234: { alive: true } });
  const manager = createServiceManager({ processes, metadataPath });
  await writeServiceMetadata(metadataPath, { pid: 1234, port: 5000 });
  const result = await manager.start();
  assert.equal(result.alreadyRunning, true);
  assert.equal(processes.spawnCount, 0);
});
```

- [ ] **Step 2: Implement detached startup safely**

The manager must:

- validate stale PID files;
- perform a health check before reporting running;
- refuse to start when port 5000 belongs to a different process;
- use the existing generated security configuration;
- bind only to `127.0.0.1`;
- rotate logs at a bounded size;
- stop gracefully before forced termination.

- [ ] **Step 3: Add explicit Windows startup registration**

`scripts/install-windows.ps1` may offer startup registration, but must not silently enable it. The opt-in command creates a current-user Scheduled Task at logon that runs the installed `service-entry` script. Uninstall removes only the OpenBrowser task.

- [ ] **Step 4: Run service and regression tests**

```bash
node --experimental-strip-types --test src/service/service-manager.test.ts
pnpm run test:node
pnpm run typecheck
pnpm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/service/service-entry.ts src/service/service-manager.ts src/service/service-manager.test.ts src/index.ts package.json scripts/install-windows.ps1
git commit -m "feat: add background local agent service"
```

---

### Task 9: Recovery, Audit History, and Cancellation

**Files:**
- Modify: `src/workflows/browser-run-store.ts`
- Modify: `src/workflows/browser-run-coordinator.ts`
- Modify: `src/server/browser-workflow-routes.ts`
- Modify: `browser-extension/src/agent-workspace.js`
- Create: `src/workflows/browser-run-recovery.test.ts`

**Interfaces:**
- Recover non-terminal runs after bridge restart.
- Cancel only before apply starts.
- Record immutable events without storing browser or control tokens.

- [ ] **Step 1: Write restart recovery tests**

```ts
test('awaiting approval survives restart without preserving approval capability', async () => {
  const first = createPersistentStore(directory);
  const run = await seedAwaitingApproval(first);
  const second = createPersistentStore(directory);
  const restored = await second.get(run.id);
  assert.equal(restored.status, 'awaiting_approval');
  assert.equal(restored.approvalToken, undefined);
});
```

- [ ] **Step 2: Define recovery behavior**

- `queued` and `building_context`: restart preparation.
- `waiting_for_model`: check the existing session; redispatch only through current claim rules.
- `validating_response`: repeat deterministic parsing and planning.
- `awaiting_approval`: restore preview, issue no approval token until the user approves again.
- `ready_to_apply`: downgrade to `awaiting_approval` after restart.
- `applying` or `verifying`: mark `failed` with `RECOVERY_REVIEW_REQUIRED`; never replay writes automatically.

- [ ] **Step 3: Add audit events**

Persist timestamped events for run creation, project selection, model completion, preview generation, operation selection, approval preparation, apply start, operation result, verification result, rejection, cancellation, and failure. Redact bearer tokens and truncate model text in summary logs.

- [ ] **Step 4: Run recovery tests**

```bash
node --experimental-strip-types --test src/workflows/browser-run-recovery.test.ts
pnpm run test:node
```

- [ ] **Step 5: Commit**

```bash
git add src/workflows/browser-run-store.ts src/workflows/browser-run-coordinator.ts src/server/browser-workflow-routes.ts browser-extension/src/agent-workspace.js src/workflows/browser-run-recovery.test.ts
git commit -m "feat: recover and audit browser agent runs"
```

---

### Task 10: End-to-End Verification, Documentation, and Rollout

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.github/workflows/verify.yml` or the current root verification workflow
- Modify: `.github/workflows/workspace-tools.yml` only if its path filters need the new extension tests
- Create: `.titan/todo/issues/browser-first-local-agent-rollout.md`

**Interfaces:**
- Produces a documented manual acceptance test and CI matrix.
- Does not merge implementation passes until each pass is independently green.

- [ ] **Step 1: Add a complete integration test**

The integration fixture must exercise:

1. register a temporary project;
2. create an agent run with the browser token;
3. emulate the provider completing the existing browser prompt session;
4. wait for `awaiting_approval`;
5. select operations;
6. prepare approval;
7. apply;
8. run quick verification;
9. assert file contents and final run status;
10. assert the browser token still cannot call `/operations/apply` directly.

- [ ] **Step 2: Add README setup and daily-use instructions**

Document this final daily workflow:

```powershell
# One-time opt-in
openbrowser service install --startup
openbrowser service start

# Daily use
# Open Chrome → ChatGPT → OpenBrowser side panel → Work
```

Also document manual service start, terminal mode, troubleshooting, token boundaries, stale preview behavior, and how to inspect logs.

- [ ] **Step 3: Run the complete verification matrix**

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run smoke:cli
pnpm run check:extension
cd browser-extension
pnpm install --frozen-lockfile
pnpm run verify
```

Run the same matrix on Linux and Windows in CI.

- [ ] **Step 4: Perform the manual Chrome acceptance test**

Required evidence:

- bridge reports online;
- registered project appears in the Work view;
- Ask completes without terminal interaction;
- Agent reaches diff review without changing files;
- reject leaves the working tree unchanged;
- approve applies only selected operations;
- destructive operation requires separate confirmation;
- stale preview blocks apply;
- verification result appears in the side panel;
- closing and reopening the panel restores the run;
- service restart does not replay file writes;
- native ChatGPT messages not sent through OpenBrowser remain unaffected.

- [ ] **Step 5: Commit**

```bash
git add README.md package.json .github/workflows .titan/todo/issues/browser-first-local-agent-rollout.md
git commit -m "docs: complete browser-first agent rollout"
```

---

## Implementation Passes

### Pass 1 — Shared Engine

Tasks 1–3. The existing CLI must behave exactly as before, but its workflow logic is reusable and independently tested.

### Pass 2 — Browser Ask and Agent Preview

Tasks 4–6. Chrome can start Ask and Agent runs and view responses and previews, but cannot yet apply changes.

### Pass 3 — Browser Approval and Apply

Task 7. Browser-driven changes become possible with two-stage approval and stale-preview protection.

### Pass 4 — No-Terminal Daily Operation

Tasks 8–9. The local CLI/bridge runs as an opt-in background service with persistence, recovery, logs, and cancellation.

### Pass 5 — Release Hardening

Task 10. Cross-platform CI, documentation, security regression tests, and manual Chrome acceptance evidence are complete.

Each pass must use a new branch created from updated `main`, create or update the cumulative issue file, pass its verification matrix, open a PR, merge after review, and delete or retire the merged branch before beginning the next pass.

---

## Definition of Done

- The user can complete Ask and Agent workflows entirely from Chrome after the local service is installed and running.
- The local root CLI/bridge remains authoritative for all project access and execution.
- The extension never stores or receives `BRIDGE_TOKEN`.
- The browser token cannot access existing control-only routes.
- Browser agent runs require a registered project ID.
- Agent responses are parsed and planned locally before any approval UI appears.
- Diffs and risks are visible before application.
- High-risk operations require separate explicit selection.
- Applying requires a second final confirmation.
- Selected operations are re-planned against the current filesystem before execution.
- Stale previews cannot be applied.
- Verification results appear in the Chrome side panel.
- Runs survive side-panel closure and safe bridge restarts.
- Interrupted apply operations are never replayed automatically.
- Existing terminal workflows remain fully functional.
- Linux and Windows CI pass.
- Manual Chrome acceptance evidence is recorded in `.titan/todo/issues/browser-first-local-agent-rollout.md`.
