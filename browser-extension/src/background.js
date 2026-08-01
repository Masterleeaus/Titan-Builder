import {
  DEFAULT_BRIDGE_CONFIG,
  getBridgeUrl,
  hostMatchesPreferredProvider,
  loadBridgeConfig,
  withBridgeAuth,
} from './bridge-config.js';
import { selectPromptTarget } from './prompt-routing.js';
import { BUILTIN_AGENT_PROFILES, BUILTIN_SKILLS, composeWorkspacePrompt, normalizeAgentProfile, normalizeSkill, resolveWorkspaceContext } from './workspace-library.js';

const RECONNECT_MS = 2500;
const DISPATCH_RETRY_MS = 1500;
const MAX_DISPATCH_ATTEMPTS = 12;
const RECOVERY_SCAN_MS = 15_000;
const KEEPALIVE_ALARM = 'openbrowser-keepalive';
const MAX_CHATGPT_EXPORT_BYTES = 15 * 1024 * 1024;

let bridgeConfig = { ...DEFAULT_BRIDGE_CONFIG };
let bridgeConfigLoaded = false;

const AI_URL_PATTERNS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://gemini.google.com/*',
  'https://chat.deepseek.com/*',
  'https://claude.ai/*',
  'https://www.perplexity.ai/*',
  'https://perplexity.ai/*',
  'https://chat.z.ai/*',
  'https://glm.ai/*',
  'https://open.bigmodel.cn/*',
  'https://grok.com/*',
];

let streamAbort = null;
let sseConnected = false;
let connecting = false;
let reconnectTimer = null;
let lastRecoveryScanAt = 0;

/** @type {Map<number, { host: string, lastSeen: number }>} */
const readyTabs = new Map();

/** @type {Array<{ job: object, attempts: number, nextTry: number }>} */
const pendingDispatches = [];

/** @type {Set<string>} */
const dispatchedSessionIds = new Set();

chrome.runtime.onInstalled.addListener(() => {
  setupKeepalive();
  void connectBridgeStream();
});

chrome.runtime.onStartup.addListener(() => {
  setupKeepalive();
  void connectBridgeStream();
});

setupKeepalive();
void refreshBridgeConfig().then(() => connectBridgeStream());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }

  const relevant = ['bridgePort', 'bridgeToken', 'preferredProvider', 'superpowerCompatibility', 'autoContinueEnabled', 'autoContinueMax', 'autoContinueFallback', 'autoContinueFallbackPrompt', 'activeProfileId', 'activeSkillIds', 'openbrowserCustomSkills', 'openbrowserCustomAgentProfiles'];
  if (!relevant.some((key) => changes[key])) {
    return;
  }

  void refreshBridgeConfig().then(() => {
    sseConnected = false;
    streamAbort?.abort();
    scheduleReconnect();
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) {
    return;
  }

  if (!sseConnected) {
    void connectBridgeStream();
  }

  void flushPendingDispatches();
  void recoverPendingJobs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPENBROWSER_REGISTER') {
    registerTab(sender.tab);
    void flushPendingDispatches();
    sendResponse({
      ok: true,
      sseConnected,
      readyTabs: readyTabs.size,
      bridgeUrl: getBridgeUrl(bridgeConfig),
      preferredProvider: bridgeConfig.preferredProvider,
      superpowerCompatibility: bridgeConfig.superpowerCompatibility,
      autoContinueEnabled: bridgeConfig.autoContinueEnabled,
      autoContinueMax: bridgeConfig.autoContinueMax,
    });
    return false;
  }

  if (message?.type === 'OPENBROWSER_PING') {
    if (!sseConnected) {
      void connectBridgeStream();
    }
    sendResponse({
      ok: true,
      sseConnected,
      readyTabs: readyTabs.size,
      bridgeUrl: getBridgeUrl(bridgeConfig),
      preferredProvider: bridgeConfig.preferredProvider,
      superpowerCompatibility: bridgeConfig.superpowerCompatibility,
      autoContinueEnabled: bridgeConfig.autoContinueEnabled,
      autoContinueMax: bridgeConfig.autoContinueMax,
    });
    return false;
  }

  if (message?.type === 'BRIDGE_REQUEST') {
    bridgeRequest(message.path, message.init ?? {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === 'OPENBROWSER_USE_PROMPT') {
    deliverLibraryPrompt(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }

  if (message?.type === 'OPENBROWSER_SCAN_CHATGPT') {
    runChatGPTPageAction('OPENBROWSER_CHATGPT_SCAN', { scan: message.scan })
      .then((result) => sendResponse({ ok: true, items: result.items ?? [] }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }

  if (message?.type === 'OPENBROWSER_FETCH_CHATGPT_FILE') {
    fetchChatGPTFile(message.url)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }

  return false;
});

async function refreshBridgeConfig() {
  bridgeConfig = await loadBridgeConfig();
  bridgeConfigLoaded = true;
  return bridgeConfig;
}

async function getBridgeConfig() {
  if (!bridgeConfigLoaded) {
    return refreshBridgeConfig();
  }
  return bridgeConfig;
}

function setupKeepalive() {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
}

function registerTab(tab) {
  if (!tab?.id || !tab.url) {
    return;
  }

  let host = '';
  try {
    host = new URL(tab.url).hostname;
  } catch {
    return;
  }

  readyTabs.set(tab.id, { host, lastSeen: Date.now() });
}

async function bridgeRequest(path, init) {
  const config = await getBridgeConfig();
  const headers = {
    ...(init.headers ?? {}),
  };

  if (init.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${getBridgeUrl(config)}${path}`, {
    ...init,
    headers: withBridgeAuth(config, headers),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Bridge ${response.status}${text ? `: ${text}` : ''}`);
  }

  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectBridgeStream();
  }, RECONNECT_MS);
}

async function connectBridgeStream() {
  if (connecting || sseConnected) {
    return;
  }

  connecting = true;
  streamAbort?.abort();
  streamAbort = new AbortController();

  try {
    const config = await getBridgeConfig();
    const response = await fetch(`${getBridgeUrl(config)}/browser/events`, {
      signal: streamAbort.signal,
      headers: withBridgeAuth(config, { Accept: 'text/event-stream' }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE failed (${response.status})`);
    }

    sseConnected = true;
    console.info('[openbrowser] Bridge SSE connected');
    await recoverPendingJobs({ force: true });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = consumeSse(buffer, (event, data) => {
        if (event === 'job') {
          void dispatchJob(data);
        }
      });
    }

    throw new Error('SSE stream ended');
  } catch (error) {
    sseConnected = false;

    if (streamAbort?.signal.aborted) {
      return;
    }

    console.warn('[openbrowser] Bridge SSE disconnected, retrying...', error);
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

function consumeSse(buffer, onEvent) {
  const chunks = buffer.split('\n\n');
  const remainder = chunks.pop() ?? '';

  for (const chunk of chunks) {
    if (!chunk.trim() || chunk.startsWith(':')) {
      continue;
    }

    let event = 'message';
    let dataLine = '';

    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLine = line.slice(5).trim();
      }
    }

    if (!dataLine) {
      continue;
    }

    try {
      onEvent(event, JSON.parse(dataLine));
    } catch {
      // Ignore malformed SSE payloads.
    }
  }

  return remainder;
}

async function recoverPendingJobs(options = {}) {
  const now = Date.now();
  if (!options.force && now - lastRecoveryScanAt < RECOVERY_SCAN_MS) {
    return;
  }
  lastRecoveryScanAt = now;

  try {
    const payload = await bridgeRequest('/browser/pending', { method: 'GET' });
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    for (const job of jobs) {
      if (!job?.sessionId) {
        continue;
      }
      dispatchedSessionIds.delete(job.sessionId);
      await dispatchJob(job);
    }
  } catch (error) {
    console.debug('[openbrowser] Pending-job recovery unavailable', error);
  }
}

async function dispatchJob(job) {
  if (!job?.sessionId) {
    return;
  }

  if (dispatchedSessionIds.has(job.sessionId)) {
    return;
  }

  const delivered = await tryDispatchJob(job);
  if (delivered) {
    dispatchedSessionIds.add(job.sessionId);
    return;
  }

  queuePendingDispatch(job);
}

function queuePendingDispatch(job) {
  const exists = pendingDispatches.some((entry) => entry.job.sessionId === job.sessionId);
  if (exists) {
    return;
  }

  pendingDispatches.push({
    job,
    attempts: 0,
    nextTry: Date.now() + DISPATCH_RETRY_MS,
  });
}

async function flushPendingDispatches() {
  const now = Date.now();

  for (let index = pendingDispatches.length - 1; index >= 0; index -= 1) {
    const entry = pendingDispatches[index];
    if (entry.nextTry > now) {
      continue;
    }

    const delivered = await tryDispatchJob(entry.job);
    if (delivered) {
      dispatchedSessionIds.add(entry.job.sessionId);
      pendingDispatches.splice(index, 1);
      continue;
    }

    entry.attempts += 1;
    entry.nextTry = now + DISPATCH_RETRY_MS;

    if (entry.attempts >= MAX_DISPATCH_ATTEMPTS) {
      console.warn('[openbrowser] Gave up dispatching job', entry.job.sessionId);
      pendingDispatches.splice(index, 1);
    }
  }
}

async function tryDispatchJob(job) {
  const tabs = await getCandidateTabs();
  const config = await getBridgeConfig();
  const workspaceInstructions = await getWorkspaceInstructions();
  const enrichedJob = {
    ...job,
    systemPrompt: mergeSystemInstructions(job.systemPrompt, workspaceInstructions),
    autoContinue: {
      enabled: config.autoContinueEnabled,
      maxContinuations: config.autoContinueMax,
      allowFallbackPrompt: config.autoContinueFallback,
      fallbackPrompt: config.autoContinueFallbackPrompt,
    },
  };

  for (const tab of tabs) {
    if (!tab.id) {
      continue;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'OPENBROWSER_JOB',
        job: {
          ...enrichedJob,
          compatibility: {
            superpower: bridgeConfig.superpowerCompatibility,
          },
        },
      });

      if (response?.ok !== false) {
        return true;
      }
    } catch {
      readyTabs.delete(tab.id);
    }
  }

  return false;
}

async function getCandidateTabs() {
  const [aiTabs, activeTabs] = await Promise.all([
    chrome.tabs.query({ url: AI_URL_PATTERNS }),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);

  const config = await getBridgeConfig();
  const providerTabs = aiTabs.filter((tab) => {
    try {
      return hostMatchesPreferredProvider(new URL(tab.url ?? '').hostname, config.preferredProvider);
    } catch {
      return false;
    }
  });

  const active = activeTabs[0];
  const activeAi = active?.id && providerTabs.some((tab) => tab.id === active.id) ? active : null;

  const registered = providerTabs
    .filter((tab) => tab.id && readyTabs.has(tab.id))
    .sort((left, right) => {
      const leftSeen = readyTabs.get(left.id)?.lastSeen ?? 0;
      const rightSeen = readyTabs.get(right.id)?.lastSeen ?? 0;
      return rightSeen - leftSeen;
    });

  const ordered = [];
  const seen = new Set();

  const push = (tab) => {
    if (!tab?.id || seen.has(tab.id)) {
      return;
    }
    seen.add(tab.id);
    ordered.push(tab);
  };

  push(activeAi);
  for (const tab of registered) {
    push(tab);
  }
  for (const tab of providerTabs) {
    push(tab);
  }

  return ordered;
}

async function deliverLibraryPrompt(message) {
  const rawPrompt = String(message?.prompt ?? '').trim();
  const prompt = await composePromptWithWorkspace(rawPrompt);
  if (!prompt) {
    throw new Error('Prompt is empty.');
  }
  if (prompt.length > 100_000) {
    throw new Error('Prompt exceeds the 100,000 character side-panel limit.');
  }

  const config = await getBridgeConfig();
  const tabs = await chrome.tabs.query({ url: AI_URL_PATTERNS });
  const target = selectPromptTarget(tabs, {
    requestedProvider: message?.provider,
    preferredProvider: config.preferredProvider,
  });

  if (!target?.id) {
    const requested = String(message?.provider ?? config.preferredProvider ?? 'AI');
    throw new Error(`No supported ${requested === 'auto' ? 'AI' : requested} tab is open.`);
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(target.id, {
      type: 'OPENBROWSER_PROMPT',
      prompt,
      submit: message?.submit === true,
      compatibility: {
        superpower: config.superpowerCompatibility,
      },
      autoContinue: {
        enabled: config.autoContinueEnabled,
        maxContinuations: config.autoContinueMax,
        allowFallbackPrompt: config.autoContinueFallback,
        fallbackPrompt: config.autoContinueFallbackPrompt,
      },
    });
  } catch (error) {
    readyTabs.delete(target.id);
    throw new Error(`The ${target.provider} tab is not ready. Reload it and try again. ${String(error?.message ?? '')}`.trim());
  }

  if (!response?.ok) {
    throw new Error(response?.error ?? 'The AI tab rejected the prompt.');
  }

  await chrome.tabs.update(target.id, { active: true }).catch(() => {});
  if (Number.isInteger(target.windowId)) {
    await chrome.windows.update(target.windowId, { focused: true }).catch(() => {});
  }

  return {
    delivered: true,
    submitted: message?.submit === true,
    tabId: target.id,
    provider: target.provider,
    providerName: response.providerName ?? target.provider,
  };
}


async function runChatGPTPageAction(type, payload = {}) {
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const active = activeTabs.find((tab) => tabs.some((candidate) => candidate.id === tab.id));
  const target = active ?? tabs.find((tab) => tab.id && readyTabs.has(tab.id)) ?? tabs[0];
  if (!target?.id) throw new Error('Open a ChatGPT tab and reload it before scanning.');
  const response = await chrome.tabs.sendMessage(target.id, { type, ...payload });
  if (!response?.ok) throw new Error(response?.error ?? 'ChatGPT page action failed.');
  return response;
}

async function fetchChatGPTFile(rawUrl) {
  const url = new URL(String(rawUrl ?? ''));
  const allowed = url.protocol === 'https:' && (
    url.hostname === 'chatgpt.com' ||
    url.hostname === 'chat.openai.com' ||
    url.hostname === 'files.oaiusercontent.com' ||
    url.hostname.endsWith('.oaiusercontent.com')
  );
  if (!allowed) throw new Error('The file URL is outside the allowed ChatGPT file hosts.');
  const response = await fetch(url.href, { credentials: 'include' });
  if (!response.ok) throw new Error(`File download failed (${response.status}).`);
  const announcedSize = Number(response.headers.get('content-length') ?? 0);
  if (announcedSize > MAX_CHATGPT_EXPORT_BYTES) throw new Error('File exceeds the 15 MB export limit.');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_CHATGPT_EXPORT_BYTES) throw new Error('File exceeds the 15 MB export limit.');
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const headerName = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i)?.[1];
  const pathName = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? 'chatgpt-file');
  return {
    base64: btoa(binary),
    filename: decodeURIComponent(headerName ?? pathName).replace(/[\\/]/g, '-'),
    type: response.headers.get('content-type') ?? 'application/octet-stream',
    size: bytes.length,
  };
}

async function getWorkspaceInstructions() {
  const stored = await chrome.storage.local.get({
    openbrowserCustomSkills: [],
    openbrowserCustomAgentProfiles: [],
    activeProfileId: '',
    activeSkillIds: [],
  });
  const customSkills = [];
  for (const item of stored.openbrowserCustomSkills) {
    try { customSkills.push(normalizeSkill(item)); } catch {}
  }
  const customProfiles = [];
  for (const item of stored.openbrowserCustomAgentProfiles) {
    try { customProfiles.push(normalizeAgentProfile(item)); } catch {}
  }
  const context = resolveWorkspaceContext({
    skills: [...BUILTIN_SKILLS, ...customSkills],
    profiles: [...BUILTIN_AGENT_PROFILES, ...customProfiles],
    activeProfileId: stored.activeProfileId,
    activeSkillIds: stored.activeSkillIds,
  });
  return composeWorkspacePrompt('', context).trim();
}

async function composePromptWithWorkspace(prompt) {
  if (!prompt || prompt.includes('--- OpenBrowser Active Agent Profile ---') || prompt.includes('--- OpenBrowser Active Skills ---')) return prompt;
  const instructions = await getWorkspaceInstructions();
  return instructions ? `${instructions}\n\n${prompt}` : prompt;
}

function mergeSystemInstructions(existing, workspace) {
  const left = String(existing ?? '').trim();
  const right = String(workspace ?? '').trim();
  if (!right || left.includes('--- OpenBrowser Active Agent Profile ---') || left.includes('--- OpenBrowser Active Skills ---')) return left;
  return [left, right].filter(Boolean).join('\n\n');
}
