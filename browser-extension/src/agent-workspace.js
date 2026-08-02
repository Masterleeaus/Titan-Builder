import { createRunEventMonitor } from './browser-run-events.js';
import { getRuntimePromptCatalog, resolvePromptBody } from './prompt-catalog.js';
import { composeRoutedPrompt, routePromptRequest } from './prompt-router.js';

const TERMINAL_STATUSES = new Set(['completed', 'rejected', 'cancelled', 'failed']);

export function buildCreateRunPayload(input = {}) {
  const mode = input.mode === 'ask' ? 'ask' : 'agent';
  const projectId = String(input.projectId || '').trim();
  const prompt = String(input.prompt || '').trim();
  if (!/^project-[A-Za-z0-9_-]+$/.test(projectId)) throw new Error('Choose a registered project.');
  if (!prompt) throw new Error('Enter a task or question.');
  const contextRefs = Array.isArray(input.contextRefs)
    ? input.contextRefs
    : String(input.contextRefs || '').split(/\r?\n|,/u);
  const payload = {
    mode,
    projectId,
    prompt,
    contextRefs: [...new Set(contextRefs.map((item) => String(item).trim()).filter(Boolean))],
    contextBudget: clampNumber(input.contextBudget, 1000, 2_000_000, 60_000),
    provider: String(input.provider || 'auto'),
  };
  if (mode === 'agent') {
    payload.verificationProfile = ['quick', 'standard', 'full'].includes(input.verificationProfile)
      ? input.verificationProfile
      : 'standard';
  }
  return payload;
}

export async function prepareRoutedWorkPrompt(input = {}, dependencies = {}) {
  const originalPrompt = String(input.prompt || '').trim();
  if (!originalPrompt) throw new Error('Enter a task or question.');
  const mode = input.mode === 'ask' ? 'ask' : 'agent';
  const catalog = dependencies.catalog || getRuntimePromptCatalog();
  const route = routePromptRequest(originalPrompt, catalog, {
    mode,
    routingMode: input.promptRoutingMode,
    manualPromptId: input.manualPromptId,
    minScore: dependencies.minScore,
    minMargin: dependencies.minMargin,
    ambiguousFloor: dependencies.ambiguousFloor,
  });

  if (route.status !== 'selected' || !route.selected) {
    return {
      prompt: originalPrompt,
      originalPrompt,
      route,
      selectedPrompt: null,
    };
  }

  const loadPromptBody = dependencies.loadPromptBody || resolvePromptBody;
  const body = await loadPromptBody(route.selected, dependencies.canonicalLoader);
  return {
    prompt: composeRoutedPrompt({
      request: originalPrompt,
      prompt: route.selected,
      body,
      route,
    }),
    originalPrompt,
    route,
    selectedPrompt: route.selected,
  };
}

export function buildOperationSelection(operations = []) {
  const selected = new Set();
  const highRisk = new Set();
  for (const operation of operations) {
    if (!operation?.id) continue;
    if (operation.requiresExplicitApproval) highRisk.add(operation.id);
    else selected.add(operation.id);
  }
  return { selected, highRisk };
}

export function reduceRunViewState(previous = {}, snapshot = {}) {
  const operations = Array.isArray(snapshot.operations) ? snapshot.operations : previous.operations || [];
  const status = snapshot.status || previous.status || 'idle';
  const selection = buildOperationSelection(operations);
  const selectedOperationIds = previous.previewRevision === snapshot.previewRevision && previous.selectedOperationIds
    ? new Set(previous.selectedOperationIds)
    : selection.selected;
  return {
    ...previous,
    ...snapshot,
    operations,
    selectedOperationIds,
    highRiskOperationIds: selection.highRisk,
    showReview: status === 'awaiting_approval',
    showApply: status === 'ready_to_apply',
    showCancel: !TERMINAL_STATUSES.has(status) && !['applying', 'verifying'].includes(status),
    terminal: TERMINAL_STATUSES.has(status),
  };
}

export function createAgentWorkspaceController({
  bridgeRequest,
  storage,
  render,
  preparePrompt = prepareRoutedWorkPrompt,
}) {
  let state = reduceRunViewState();

  const publish = () => {
    render?.(state);
    return state;
  };

  const acceptSnapshot = (snapshot) => {
    state = reduceRunViewState(state, snapshot || {});
    return publish();
  };

  return {
    getState: () => state,
    acceptSnapshot,

    async start(input) {
      const prepared = await preparePrompt(input);
      const payload = buildCreateRunPayload({ ...input, prompt: prepared.prompt });
      const snapshot = await bridgeRequest({ type: 'OPENBROWSER_CREATE_RUN', payload });
      state = reduceRunViewState({}, snapshot);
      state.promptRoute = prepared.route;
      state.selectedPrompt = prepared.selectedPrompt;
      state.originalPrompt = prepared.originalPrompt;
      state.notice = routeNotice(prepared.route, prepared.selectedPrompt);
      await storage?.set?.({ openbrowserActiveRunId: snapshot.id });
      return publish();
    },

    async refresh() {
      if (!state.id) return state;
      return acceptSnapshot(await bridgeRequest({ type: 'OPENBROWSER_GET_RUN', runId: state.id }));
    },

    setSelected(operationId, selected, highRiskConfirmed = false) {
      const next = new Set(state.selectedOperationIds || []);
      const isHighRisk = state.highRiskOperationIds?.has(operationId);
      if (selected && (!isHighRisk || highRiskConfirmed)) next.add(operationId);
      else next.delete(operationId);
      state = { ...state, selectedOperationIds: next };
      return publish();
    },

    async approve(selectedIds) {
      if (!state.id || !state.previewRevision) throw new Error('No reviewed preview is available.');
      const ids = selectedIds || [...(state.selectedOperationIds || [])];
      if (!ids.length) throw new Error('Select at least one operation.');
      const approval = await bridgeRequest({
        type: 'OPENBROWSER_APPROVE_RUN',
        runId: state.id,
        previewRevision: state.previewRevision,
        selectedOperationIds: ids,
      });
      state = {
        ...state,
        status: 'ready_to_apply',
        showReview: false,
        showApply: true,
        approvalToken: approval.approvalToken,
        approvalExpiresAt: approval.expiresAt,
        notice: 'Review complete. Confirm once more to apply the selected operations.',
      };
      return publish();
    },

    async apply() {
      if (!state.id || !state.approvalToken) throw new Error('Final approval is required.');
      const token = state.approvalToken;
      try {
        const snapshot = await bridgeRequest({
          type: 'OPENBROWSER_APPLY_RUN',
          runId: state.id,
          approvalToken: token,
        });
        state = reduceRunViewState({ ...state, approvalToken: undefined }, snapshot);
        await storage?.remove?.('openbrowserApprovalToken');
        return publish();
      } catch (error) {
        if (error?.code === 'STALE_PREVIEW') {
          state = reduceRunViewState(
            {
              ...state,
              approvalToken: undefined,
              notice: 'The project changed after this preview. Review the updated diff and approve again.',
            },
            error.snapshot || {
              id: state.id,
              status: 'awaiting_approval',
              previewRevision: error.replacementPreviewRevision,
              operations: error.replacementOperations || [],
            },
          );
          state.showReview = true;
          state.showApply = false;
          await storage?.remove?.('openbrowserApprovalToken');
          publish();
        }
        throw error;
      }
    },

    async reject() {
      if (!state.id) return state;
      const snapshot = await bridgeRequest({ type: 'OPENBROWSER_REJECT_RUN', runId: state.id });
      state = reduceRunViewState({ ...state, approvalToken: undefined }, snapshot);
      await storage?.remove?.('openbrowserApprovalToken');
      return publish();
    },

    async cancel() {
      if (!state.id) return state;
      const snapshot = await bridgeRequest({ type: 'OPENBROWSER_CANCEL_RUN', runId: state.id });
      state = reduceRunViewState({ ...state, approvalToken: undefined }, snapshot);
      await storage?.remove?.('openbrowserApprovalToken');
      return publish();
    },
  };
}

function routeNotice(route, selectedPrompt) {
  if (route?.status === 'selected' && selectedPrompt) {
    return `Prompt selected: ${selectedPrompt.title} (${route.reason}, score ${route.score}).`;
  }
  if (route?.status === 'ambiguous') return 'Prompt routing was ambiguous. The original request was sent unchanged.';
  if (route?.status === 'none') return 'No prompt matched confidently. The original request was sent unchanged.';
  if (route?.status === 'off') return 'Prompt routing was disabled. The original request was sent unchanged.';
  return '';
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function toBridgeRequest(message) {
  switch (message?.type) {
    case 'OPENBROWSER_LIST_PROJECTS':
      return { type: 'BRIDGE_REQUEST', path: '/projects', init: { method: 'GET' } };
    case 'OPENBROWSER_CREATE_RUN':
      return {
        type: 'BRIDGE_REQUEST',
        path: '/workspace/runs',
        init: { method: 'POST', body: JSON.stringify(message.payload) },
      };
    case 'OPENBROWSER_GET_RUN':
      return {
        type: 'BRIDGE_REQUEST',
        path: `/workspace/runs/${encodeURIComponent(message.runId)}`,
        init: { method: 'GET' },
      };
    case 'OPENBROWSER_APPROVE_RUN':
      return {
        type: 'BRIDGE_REQUEST',
        path: `/workspace/runs/${encodeURIComponent(message.runId)}/approve`,
        init: {
          method: 'POST',
          body: JSON.stringify({
            previewRevision: message.previewRevision,
            selectedOperationIds: message.selectedOperationIds,
          }),
        },
      };
    case 'OPENBROWSER_APPLY_RUN':
      return {
        type: 'BRIDGE_REQUEST',
        path: `/workspace/runs/${encodeURIComponent(message.runId)}/apply`,
        init: { method: 'POST', body: JSON.stringify({ approvalToken: message.approvalToken }) },
      };
    case 'OPENBROWSER_REJECT_RUN':
      return {
        type: 'BRIDGE_REQUEST',
        path: `/workspace/runs/${encodeURIComponent(message.runId)}/reject`,
        init: { method: 'POST', body: '{}' },
      };
    case 'OPENBROWSER_CANCEL_RUN':
      return {
        type: 'BRIDGE_REQUEST',
        path: `/workspace/runs/${encodeURIComponent(message.runId)}/cancel`,
        init: { method: 'POST', body: '{}' },
      };
    default:
      return message;
  }
}

function runtimeRequest(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(toBridgeRequest(message), (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) return reject(new Error(runtimeError.message));
      if (!response?.ok) return reject(parseBridgeError(response?.error));
      resolve(response.data);
    });
  });
}

export function parseBridgeError(value) {
  const text = String(value || 'OpenBrowser request failed');
  const error = new Error(text);
  const jsonStart = text.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const details = JSON.parse(text.slice(jsonStart));
      error.code = details.error;
      error.snapshot = details.snapshot;
      error.replacementPreviewRevision = details.replacementPreviewRevision;
      error.replacementOperations = details.replacementOperations || details.replacementPlans;
      error.message = details.message || details.error || text;
    } catch {
      // Preserve the original bridge error.
    }
  }
  return error;
}

function chromeStorage() {
  return {
    get: (keys) => chrome.storage.local.get(keys),
    set: (value) => chrome.storage.local.set(value),
    remove: (keys) => chrome.storage.local.remove(keys),
  };
}

function renderDom(state) {
  const status = document.querySelector('#work-run-status');
  const answer = document.querySelector('#work-answer');
  const operations = document.querySelector('#work-operation-list');
  const review = document.querySelector('#work-review-actions');
  const apply = document.querySelector('#work-apply-actions');
  const notice = document.querySelector('#work-notice');
  const cancel = document.querySelector('#work-cancel');
  if (status) status.textContent = state.status && state.status !== 'idle' ? state.status.replaceAll('_', ' ') : 'No active run';
  if (answer) answer.textContent = state.responseText || '';
  if (notice) notice.textContent = state.notice || state.error || '';
  if (review) review.hidden = !state.showReview;
  if (apply) apply.hidden = !state.showApply;
  if (cancel) cancel.hidden = !state.showCancel;
  if (!operations) return;
  operations.replaceChildren();
  for (const operation of state.operations || []) {
    const article = document.createElement('article');
    article.className = 'operation-card';
    const header = document.createElement('div');
    header.className = 'operation-header';
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedOperationIds?.has(operation.id) || false;
    checkbox.addEventListener('change', () => {
      const confirmed = !operation.requiresExplicitApproval || window.confirm(`Approve ${operation.risk} operation?`);
      controller?.setSelected(operation.id, checkbox.checked, confirmed);
    });
    label.append(checkbox, document.createTextNode(` ${operation.action}${operation.path ? ` · ${operation.path}` : ''}`));
    const risk = document.createElement('span');
    risk.className = `risk-badge risk-${String(operation.risk || '').toLowerCase()}`;
    risk.textContent = operation.risk || 'UNKNOWN';
    header.append(label, risk);
    const pre = document.createElement('pre');
    pre.textContent = operation.diff || operation.summary || '';
    article.append(header, pre);
    operations.append(article);
  }
}

let controller;
let monitor;
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    const form = document.querySelector('#work-form');
    if (!form) return;
    controller = createAgentWorkspaceController({
      bridgeRequest: runtimeRequest,
      storage: chromeStorage(),
      render: renderDom,
    });
    monitor = createRunEventMonitor({
      request: (path) => runtimeRequest({ type: 'BRIDGE_REQUEST', path, init: { method: 'GET' } }),
      onSnapshot: (snapshot) => controller.acceptSnapshot(snapshot),
    });
    const projects = await runtimeRequest({ type: 'OPENBROWSER_LIST_PROJECTS' }).catch(() => ({ projects: [] }));
    const projectSelect = document.querySelector('#work-project');
    for (const project of projects?.projects || []) {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      projectSelect?.append(option);
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fields = new FormData(form);
      try {
        const snapshot = await controller.start(Object.fromEntries(fields.entries()));
        await monitor.start(snapshot.id);
      } catch (error) {
        controller.acceptSnapshot({ error: error.message, notice: error.message });
      }
    });
    document.querySelector('#work-approve')?.addEventListener('click', () => controller.approve().catch((error) => controller.acceptSnapshot({ notice: error.message })));
    document.querySelector('#work-apply')?.addEventListener('click', () => controller.apply().then(() => monitor.start(controller.getState().id)).catch((error) => controller.acceptSnapshot({ notice: error.message })));
    document.querySelector('#work-reject')?.addEventListener('click', () => controller.reject());
    document.querySelector('#work-cancel')?.addEventListener('click', () => controller.cancel());
    document.querySelector('#work-refresh')?.addEventListener('click', () => controller.refresh());
    const saved = await chrome.storage.local.get('openbrowserActiveRunId');
    if (saved.openbrowserActiveRunId) {
      controller.acceptSnapshot({ id: saved.openbrowserActiveRunId });
      await monitor.start(saved.openbrowserActiveRunId).catch(() => undefined);
    }
    window.addEventListener('pagehide', () => monitor.stop(), { once: true });
  });
}
