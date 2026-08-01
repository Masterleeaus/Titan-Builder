import {
  getBridgeUrl,
  loadBridgeConfig,
  saveBridgeConfig,
} from './bridge-config.js';

const PROVIDERS = [
  { name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
  { name: 'Claude', hosts: ['claude.ai'] },
  { name: 'Perplexity', hosts: ['www.perplexity.ai', 'perplexity.ai'] },
  { name: 'GLM', hosts: ['chat.z.ai', 'glm.ai', 'open.bigmodel.cn'] },
  { name: 'Grok', hosts: ['grok.com'] },
  { name: 'Gemini', hosts: ['gemini.google.com'] },
  { name: 'DeepSeek', hosts: ['chat.deepseek.com'] },
];

const URL_PATTERNS = PROVIDERS.flatMap((provider) =>
  provider.hosts.map((host) => `https://${host}/*`),
);

const bridgeDot = document.querySelector('#bridge-dot');
const bridgeStatus = document.querySelector('#bridge-status');
const bridgeMeta = document.querySelector('#bridge-meta');
const pageDot = document.querySelector('#page-dot');
const pageHost = document.querySelector('#page-host');
const pageProvider = document.querySelector('#page-provider');
const providerList = document.querySelector('#provider-list');
const tabsSummary = document.querySelector('#tabs-summary');
const refreshButton = document.querySelector('#check');
const saveButton = document.querySelector('#save-settings');
const portInput = document.querySelector('#bridge-port');
const tokenInput = document.querySelector('#bridge-token');
const providerSelect = document.querySelector('#preferred-provider');
const superpowerCheckbox = document.querySelector('#superpower-compatibility');
const settingsResult = document.querySelector('#settings-result');
const openSidepanelButton = document.querySelector('#open-sidepanel');
const extensionVersion = document.querySelector('#extension-version');

refreshButton.addEventListener('click', refreshStatus);
openSidepanelButton.addEventListener('click', openCodingSidePanel);
saveButton.addEventListener('click', saveSettings);
void initialize();

async function openCodingSidePanel() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    if (!currentWindow?.id) {
      throw new Error('Current window is unavailable.');
    }
    await chrome.sidePanel.open({ windowId: currentWindow.id });
    globalThis.close();
  } catch (error) {
    settingsResult.textContent = `Could not open side panel: ${String(error?.message ?? error)}`;
  }
}

async function initialize() {
  extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;
  const config = await loadBridgeConfig();
  renderSettings(config);
  await refreshStatus();
}

function renderSettings(config) {
  portInput.value = String(config.bridgePort);
  tokenInput.value = config.bridgeToken;
  providerSelect.value = config.preferredProvider;
  superpowerCheckbox.checked = config.superpowerCompatibility;
}

async function saveSettings() {
  settingsResult.textContent = 'Saving...';
  const config = await saveBridgeConfig({
    bridgePort: Number(portInput.value),
    bridgeToken: tokenInput.value,
    preferredProvider: providerSelect.value,
    superpowerCompatibility: superpowerCheckbox.checked,
  });
  renderSettings(config);
  settingsResult.textContent = 'Saved. The bridge connection will restart automatically.';
  await refreshStatus();
}

async function refreshStatus() {
  bridgeStatus.textContent = 'Checking bridge...';
  setDot(bridgeDot, 'pending');

  const config = await loadBridgeConfig();
  const [bridgeOk, workerStatus, tabs, activeTab] = await Promise.all([
    checkBridge(config),
    checkWorker(),
    chrome.tabs.query({ url: URL_PATTERNS }),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);

  const bridgeUrl = workerStatus?.bridgeUrl ?? getBridgeUrl(config);

  if (bridgeOk && workerStatus?.sseConnected) {
    setDot(bridgeDot, 'online');
    bridgeStatus.textContent = 'Connected';
    bridgeMeta.textContent = `${bridgeUrl} · SSE active · ${workerStatus.readyTabs} tab(s)`;
  } else if (bridgeOk) {
    setDot(bridgeDot, 'pending');
    bridgeStatus.textContent = 'Bridge up, extension connecting...';
    bridgeMeta.textContent = `${bridgeUrl} · reload AI tab if jobs do not arrive`;
  } else {
    setDot(bridgeDot, 'offline');
    bridgeStatus.textContent = 'Offline';
    bridgeMeta.textContent = `Run openbrowser on port ${config.bridgePort} in your project folder`;
  }

  const activeHost = getHostname(activeTab[0]?.url);
  const activeProvider = findProvider(activeHost);

  if (activeProvider) {
    setDot(pageDot, bridgeOk ? 'online' : 'pending');
    pageHost.textContent = activeHost;
    pageProvider.textContent = `${activeProvider.name} detected`;
  } else if (activeHost) {
    setDot(pageDot, 'offline');
    pageHost.textContent = activeHost;
    pageProvider.textContent = 'Unsupported host';
  } else {
    setDot(pageDot, 'offline');
    pageHost.textContent = 'No active tab';
    pageProvider.textContent = 'Open an AI chat page';
  }

  renderProviders(tabs);
  tabsSummary.textContent = `${tabs.length} AI tab(s) open · routing: ${config.preferredProvider}`;
}

async function checkBridge(config) {
  try {
    const started = performance.now();
    const response = await fetch(`${getBridgeUrl(config)}/health`);
    if (!response.ok) {
      return false;
    }
    const latency = Math.round(performance.now() - started);
    bridgeMeta.textContent = `${getBridgeUrl(config)} · ${latency}ms`;
    return true;
  } catch {
    return false;
  }
}

async function checkWorker() {
  try {
    return await chrome.runtime.sendMessage({ type: 'OPENBROWSER_PING' });
  } catch {
    return null;
  }
}

function renderProviders(tabs) {
  const openHosts = new Set(
    tabs.map((tab) => getHostname(tab.url)).filter(Boolean),
  );

  providerList.replaceChildren(
    ...PROVIDERS.map((provider) => {
      const item = document.createElement('li');
      const isOpen = provider.hosts.some((host) => openHosts.has(host));
      item.className = `provider-item ${isOpen ? 'open' : 'closed'}`;

      const dot = document.createElement('span');
      dot.className = `dot ${isOpen ? 'online' : 'offline'}`;
      const name = document.createElement('span');
      name.className = 'provider-name';
      name.textContent = provider.name;
      const host = document.createElement('span');
      host.className = 'provider-host';
      host.textContent = provider.hosts[0];
      item.append(dot, name, host);
      return item;
    }),
  );
}

function findProvider(hostname) {
  if (!hostname) {
    return null;
  }
  return PROVIDERS.find((provider) => provider.hosts.includes(hostname)) ?? null;
}

function getHostname(url) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function setDot(element, state) {
  element.className = `dot ${state}`;
}
