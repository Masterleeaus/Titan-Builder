export const PROMPT_PROVIDER_HOSTS = Object.freeze({
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  claude: ['claude.ai'],
  gemini: ['gemini.google.com'],
  deepseek: ['chat.deepseek.com'],
  perplexity: ['www.perplexity.ai', 'perplexity.ai'],
  glm: ['chat.z.ai', 'glm.ai', 'open.bigmodel.cn'],
  grok: ['grok.com'],
});

const PROMPT_PROVIDER_PATHS = Object.freeze({
  grok: [/^\/$/, /^\/(?:c|chat)(?:\/|$)/],
});

export function getProviderKeyForUrl(url) {
  if (!url) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  for (const [provider, hosts] of Object.entries(PROMPT_PROVIDER_HOSTS)) {
    if (!hosts.includes(parsed.hostname)) {
      continue;
    }
    const pathRules = PROMPT_PROVIDER_PATHS[provider];
    if (!pathRules || pathRules.some((rule) => rule.test(parsed.pathname))) {
      return provider;
    }
  }

  return null;
}

export function selectPromptTarget(tabs, options = {}) {
  const supported = (Array.isArray(tabs) ? tabs : [])
    .map((tab) => ({ ...tab, provider: getProviderKeyForUrl(tab.url) }))
    .filter((tab) => Number.isInteger(tab.id) && tab.provider);

  if (supported.length === 0) {
    return null;
  }

  const requestedProvider = normalizeProvider(options.requestedProvider);
  const preferredProvider = normalizeProvider(options.preferredProvider);

  if (requestedProvider && requestedProvider !== 'auto') {
    return newestTab(supported.filter((tab) => tab.provider === requestedProvider));
  }

  if (preferredProvider && preferredProvider !== 'auto') {
    const preferred = newestTab(supported.filter((tab) => tab.provider === preferredProvider));
    if (preferred) {
      return preferred;
    }
  }

  return (
    newestTab(supported.filter((tab) => tab.active)) ??
    newestTab(supported)
  );
}

function newestTab(tabs) {
  if (!tabs.length) {
    return null;
  }
  return [...tabs].sort((left, right) => {
    if (Boolean(left.active) !== Boolean(right.active)) {
      return left.active ? -1 : 1;
    }
    return Number(right.lastAccessed ?? 0) - Number(left.lastAccessed ?? 0);
  })[0];
}

function normalizeProvider(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'auto' || PROMPT_PROVIDER_HOSTS[normalized]) {
    return normalized;
  }
  return '';
}
