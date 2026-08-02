export const DEFAULT_BRIDGE_CONFIG = Object.freeze({
  bridgePort: 5000,
  bridgeToken: '',
  preferredProvider: 'auto',
  superpowerCompatibility: true,
  autoContinueEnabled: false,
  autoContinueMax: 3,
  autoContinueFallback: false,
  autoContinueFallbackPrompt: 'Continue from where you stopped. Do not repeat completed content.',
  activeProfileId: '',
  activeSkillIds: [],
});

const PROVIDER_HOSTS = Object.freeze({
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  claude: ['claude.ai'],
  gemini: ['gemini.google.com'],
  deepseek: ['chat.deepseek.com'],
  perplexity: ['www.perplexity.ai', 'perplexity.ai'],
  glm: ['chat.z.ai', 'glm.ai', 'open.bigmodel.cn'],
  grok: ['grok.com'],
});

export async function loadBridgeConfig() {
  await restrictStorageAccessLevel();
  const stored = await chrome.storage.local.get(DEFAULT_BRIDGE_CONFIG);
  return normalizeBridgeConfig(stored);
}

async function restrictStorageAccessLevel() {
  try {
    if (chrome.storage.local.setAccessLevel) {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
  } catch (error) {
    console.warn('[openbrowser] Failed to restrict storage access level', error);
  }
}

export async function saveBridgeConfig(input) {
  const normalized = normalizeBridgeConfig(input);
  await restrictStorageAccessLevel();
  await chrome.storage.local.set(normalized);
  return normalized;
}

export function normalizeBridgeConfig(input = {}) {
  const port = Number(input.bridgePort);
  const preferredProvider = String(input.preferredProvider ?? 'auto').toLowerCase();

  const rawAutoContinueMax = Number(input.autoContinueMax);
  const activeSkillIds = [...new Set((Array.isArray(input.activeSkillIds) ? input.activeSkillIds : [])
    .map((item) => String(item).trim())
    .filter(Boolean))];

  return {
    bridgePort: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 5000,
    bridgeToken: String(input.bridgeToken ?? '').trim(),
    preferredProvider:
      preferredProvider === 'auto' || PROVIDER_HOSTS[preferredProvider]
        ? preferredProvider
        : 'auto',
    superpowerCompatibility: input.superpowerCompatibility !== false,
    autoContinueEnabled: input.autoContinueEnabled === true,
    autoContinueMax: Number.isFinite(rawAutoContinueMax)
      ? Math.min(10, Math.max(1, Math.trunc(rawAutoContinueMax)))
      : 3,
    autoContinueFallback: input.autoContinueFallback === true,
    autoContinueFallbackPrompt: String(input.autoContinueFallbackPrompt ?? 'Continue from where you stopped. Do not repeat completed content.').trim() || 'Continue from where you stopped. Do not repeat completed content.',
    activeProfileId: String(input.activeProfileId ?? '').trim(),
    activeSkillIds,
  };
}

export function getBridgeUrl(config) {
  return `http://127.0.0.1:${config.bridgePort}`;
}

export function withBridgeAuth(config, headers = {}) {
  const merged = { ...headers };
  if (isStrongBridgeToken(config.bridgeToken)) {
    merged.Authorization = `Bearer ${config.bridgeToken}`;
  }
  return merged;
}

export function isStrongBridgeToken(value) {
  return String(value ?? '').trim().length >= 32;
}

export function hostMatchesPreferredProvider(hostname, preferredProvider) {
  if (!hostname || !preferredProvider || preferredProvider === 'auto') {
    return true;
  }
  return (PROVIDER_HOSTS[preferredProvider] ?? []).includes(hostname);
}
