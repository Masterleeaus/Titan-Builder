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

export function createAgentWorkspaceController({ bridgeRequest, storage, render }) {
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
      const payload = buildCreateRunPayload(input);
      const snapshot = await bridgeRequest({ type: 'OPENBROWSER_CREATE_RUN', payload });
      state = reduceRunViewState({}, snapshot);
      state.notice = '';
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

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function runtimeRequest(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) return reject(new Error(runtimeError.message));
      if (!response?.ok) {
        const error = new Error(response?.error || 'OpenBrowser request failed');
        Object.assign(error, response || {});
        return reject(error);
      }
      resolve(response.data);
    });
  });
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
  if (status) status.textContent = state.status && state.status !== 'idle' ? state.status.replaceAll('_', ' ') : 'No active run';
  if (answer) answer.textContent = state.responseText || '';
  if (notice) notice.textContent = state.notice || state.error || '';
  if (review) review.hidden = !state.showReview;
  if (apply) apply.hidden = !state.showApply;
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
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    const form = document.querySelector('#work-form');
    if (!form) return;
    controller = createAgentWorkspaceController({
      bridgeRequest: runtimeRequest,
      storage: chromeStorage(),
      render: renderDom,
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
        await controller.start(Object.fromEntries(fields.entries()));
      } catch (error) {
        controller.acceptSnapshot({ error: error.message, notice: error.message });
      }
    });
    document.querySelector('#work-approve')?.addEventListener('click', () => controller.approve().catch((error) => controller.acceptSnapshot({ notice: error.message })));
    document.querySelector('#work-apply')?.addEventListener('click', () => controller.apply().catch((error) => controller.acceptSnapshot({ notice: error.message })));
    document.querySelector('#work-reject')?.addEventListener('click', () => controller.reject());
    document.querySelector('#work-cancel')?.addEventListener('click', () => controller.cancel());
    document.querySelector('#work-refresh')?.addEventListener('click', () => controller.refresh());
    const saved = await chrome.storage.local.get('openbrowserActiveRunId');
    if (saved.openbrowserActiveRunId) {
      controller.acceptSnapshot({ id: saved.openbrowserActiveRunId });
      await controller.refresh().catch(() => undefined);
    }
  });
}
