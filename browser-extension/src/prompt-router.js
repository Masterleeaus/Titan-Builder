const DEFAULT_MIN_SCORE = 28;
const DEFAULT_MIN_MARGIN = 8;
const DEFAULT_AMBIGUOUS_FLOOR = 18;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for', 'from',
  'how', 'i', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'please', 'the', 'this',
  'to', 'use', 'using', 'we', 'with', 'you', 'your',
]);

export function rankPrompts(request, prompts, options = {}) {
  const normalizedRequest = normalizeText(request);
  const requestTokens = tokenSet(normalizedRequest);
  const mode = normalizeMode(options.mode);

  return (Array.isArray(prompts) ? prompts : [])
    .filter((prompt) => supportsMode(prompt, mode))
    .map((prompt) => scorePrompt(prompt, normalizedRequest, requestTokens))
    .sort((left, right) => right.score - left.score || left.prompt.id.localeCompare(right.prompt.id));
}

export function routePromptRequest(request, prompts, options = {}) {
  const routingMode = normalizeRoutingMode(options.routingMode);
  const mode = normalizeMode(options.mode);
  const records = Array.isArray(prompts) ? prompts : [];

  if (routingMode === 'off') {
    return {
      status: 'off',
      selected: null,
      candidates: [],
      score: 0,
      margin: 0,
      reason: 'off',
    };
  }

  if (routingMode === 'manual') {
    const manualId = String(options.manualPromptId || '').trim();
    const selected = records.find((prompt) => prompt.id === manualId);
    if (!selected) throw new Error(`Manual prompt selection is invalid: ${manualId || 'no prompt selected'}.`);
    if (!supportsMode(selected, mode)) throw new Error(`Manual prompt ${manualId} does not support ${mode} mode.`);
    return {
      status: 'selected',
      selected,
      candidates: [{ prompt: selected, score: 100, evidence: [{ type: 'manual', value: manualId, points: 100 }] }],
      score: 100,
      margin: 100,
      reason: 'manual',
    };
  }

  const normalizedRequest = normalizeText(request);
  const explicitId = records
    .filter((prompt) => supportsMode(prompt, mode))
    .find((prompt) => containsIdentifier(normalizedRequest, prompt.id));
  if (explicitId) {
    return exactResult(explicitId, 'explicit-id');
  }

  const exactTitle = records
    .filter((prompt) => supportsMode(prompt, mode))
    .find((prompt) => normalizeText(prompt.title) === normalizedRequest);
  if (exactTitle) {
    return exactResult(exactTitle, 'exact-title');
  }

  const ranked = rankPrompts(request, records, { mode });
  const top = ranked[0];
  const second = ranked[1];
  const minScore = finiteNumber(options.minScore, DEFAULT_MIN_SCORE);
  const minMargin = finiteNumber(options.minMargin, DEFAULT_MIN_MARGIN);
  const ambiguousFloor = finiteNumber(options.ambiguousFloor, DEFAULT_AMBIGUOUS_FLOOR);
  const margin = top ? top.score - (second?.score ?? 0) : 0;

  if (!top || top.score < ambiguousFloor) {
    return {
      status: 'none',
      selected: null,
      candidates: ranked.slice(0, 3),
      score: top?.score ?? 0,
      margin,
      reason: 'below-relevance-floor',
    };
  }

  if (top.score >= minScore && margin >= minMargin) {
    return {
      status: 'selected',
      selected: top.prompt,
      candidates: ranked.slice(0, 3),
      score: top.score,
      margin,
      reason: 'auto',
    };
  }

  return {
    status: 'ambiguous',
    selected: null,
    candidates: ranked.slice(0, 3),
    score: top.score,
    margin,
    reason: 'insufficient-confidence-margin',
  };
}

export function composeRoutedPrompt(input = {}) {
  const request = String(input.request ?? '').trim();
  const prompt = input.prompt || {};
  const body = String(input.body ?? '').trim();
  if (!request) throw new Error('Original user request is required.');
  if (!prompt.id || !prompt.title) throw new Error('Selected prompt identity is required.');
  if (!body) throw new Error('Selected prompt body is required.');

  const route = input.route || {};
  const version = prompt.version ? ` v${prompt.version}` : '';
  const score = Number.isFinite(route.score) ? route.score : 'n/a';
  const margin = Number.isFinite(route.margin) ? route.margin : 'n/a';

  return [
    '# Titan Builder Routed Development Task',
    '',
    '## Selected Prompt',
    `- ID: ${prompt.id}`,
    `- Name: ${prompt.title}${version}`,
    `- Routing reason: ${route.reason || 'selected'}`,
    `- Routing score: ${score}`,
    `- Routing margin: ${margin}`,
    '',
    '## Original User Request',
    request,
    '',
    '## Runtime Application Rules',
    '1. Apply the selected prompt as the execution procedure for the current registered project.',
    '2. Preserve the original user request and its constraints; do not replace it with a broader objective.',
    '3. Resolve repository, project, branch, scope, output-path, and similar variables from trusted runtime context and the original request.',
    '4. Do not invent unresolved required values. Return a focused question or BLOCKED result when a required value cannot be resolved safely.',
    '5. Preserve all existing project-registration, path-containment, permission, review, approval, stale-preview, verification, and audit controls.',
    '6. This is a platform-development task. Do not operate a live field-service business or create live customer, job, invoice, attendance, communication, or payment records.',
    '',
    '## Selected Prompt Specification',
    body,
  ].join('\n');
}

function scorePrompt(prompt, normalizedRequest, requestTokens) {
  const evidence = [];
  let score = 0;

  const routingIntentScore = bestPhraseScore(
    normalizedRequest,
    requestTokens,
    prompt.routingIntents,
    40,
    30,
    'routing-intent',
    evidence,
  );
  score += routingIntentScore;

  score += weightedTokenScore(requestTokens, prompt.title, 24, 'title', evidence);
  score += weightedTokenScore(requestTokens, prompt.purpose, 20, 'purpose', evidence);
  score += weightedTokenScore(
    requestTokens,
    [...asArray(prompt.tags), prompt.category].join(' '),
    16,
    'tags-category',
    evidence,
  );
  score += weightedTokenScore(requestTokens, prompt.description, 12, 'description', evidence);
  score += weightedTokenScore(requestTokens, prompt.content, 8, 'content', evidence);

  const negativeEvidence = [];
  const negativeScore = bestPhraseScore(
    normalizedRequest,
    requestTokens,
    prompt.negativeRoutingIntents,
    40,
    20,
    'negative-intent',
    negativeEvidence,
  );
  if (negativeScore > 0) {
    score -= negativeScore;
    evidence.push(...negativeEvidence.map((item) => ({ ...item, points: -Math.abs(item.points) })));
  }

  return {
    prompt,
    score: roundScore(score),
    evidence,
  };
}

function weightedTokenScore(requestTokens, value, maximum, type, evidence) {
  const targetTokens = tokenSet(value);
  if (!targetTokens.size || !requestTokens.size) return 0;
  const matched = [...targetTokens].filter((token) => requestTokens.has(token));
  if (!matched.length) return 0;
  const coverage = matched.length / targetTokens.size;
  const requestCoverage = matched.length / requestTokens.size;
  const points = maximum * Math.min(1, coverage * 0.75 + requestCoverage * 0.25);
  const rounded = roundScore(points);
  evidence.push({ type, value: matched.join(', '), points: rounded });
  return rounded;
}

function bestPhraseScore(normalizedRequest, requestTokens, phrases, exactMaximum, overlapMaximum, type, evidence) {
  let best = null;
  for (const rawPhrase of asArray(phrases)) {
    const phrase = normalizeText(rawPhrase);
    if (!phrase) continue;
    let points = 0;
    if (normalizedRequest.includes(phrase)) {
      points = exactMaximum;
    } else {
      const phraseTokens = tokenSet(phrase);
      if (!phraseTokens.size) continue;
      const matched = [...phraseTokens].filter((token) => requestTokens.has(token));
      const coverage = matched.length / phraseTokens.size;
      if (coverage >= 0.6) points = overlapMaximum * coverage;
    }
    if (points > (best?.points ?? 0)) best = { phrase, points: roundScore(points) };
  }
  if (!best) return 0;
  evidence.push({ type, value: best.phrase, points: best.points });
  return best.points;
}

function exactResult(prompt, reason) {
  return {
    status: 'selected',
    selected: prompt,
    candidates: [{ prompt, score: 100, evidence: [{ type: reason, value: prompt.id, points: 100 }] }],
    score: 100,
    margin: 100,
    reason,
  };
}

function normalizeRoutingMode(value) {
  return value === 'manual' || value === 'off' ? value : 'auto';
}

function normalizeMode(value) {
  return value === 'ask' ? 'ask' : 'agent';
}

function supportsMode(prompt, mode) {
  const workModes = asArray(prompt?.workModes).map((item) => normalizeText(item));
  return !workModes.length || workModes.includes(mode);
}

function containsIdentifier(normalizedRequest, id) {
  const normalizedId = normalizeText(id);
  if (!normalizedId) return false;
  return normalizedRequest.split(/\s+/u).includes(normalizedId) || normalizedRequest.includes(normalizedId);
}

function tokenSet(value) {
  const normalized = normalizeText(value);
  const tokens = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}._/+:-]*/gu) || [];
  return new Set(tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token)));
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return String(value).split(/[,;\n]/u).map((item) => item.trim()).filter(Boolean);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundScore(value) {
  return Math.round(value * 10) / 10;
}
