const DEFAULT_FALLBACK = 'Continue from where you stopped. Do not repeat completed content.';

export function normalizeAutoContinueSettings(input = {}) {
  const rawMax = Number(input.maxContinuations);
  const maxContinuations = Number.isFinite(rawMax)
    ? Math.min(10, Math.max(1, Math.trunc(rawMax)))
    : 3;
  return {
    enabled: input.enabled === true,
    maxContinuations,
    allowFallbackPrompt: input.allowFallbackPrompt === true,
    fallbackPrompt: String(input.fallbackPrompt ?? DEFAULT_FALLBACK).trim() || DEFAULT_FALLBACK,
  };
}

export function shouldAutoContinue({ settings, count = 0, scope = 'unknown', mode = 'ask' } = {}) {
  const normalized = normalizeAutoContinueSettings(settings);
  if (!normalized.enabled) return false;
  if (!['panel', 'job'].includes(scope)) return false;
  if (mode !== 'ask') return false;
  return Number(count) < normalized.maxContinuations;
}

export function getContinuationAction({ settings, nativeAvailable = false } = {}) {
  const normalized = normalizeAutoContinueSettings(settings);
  if (nativeAvailable) return { type: 'native' };
  if (normalized.allowFallbackPrompt) {
    return { type: 'fallback', prompt: normalized.fallbackPrompt };
  }
  return { type: 'stop' };
}
