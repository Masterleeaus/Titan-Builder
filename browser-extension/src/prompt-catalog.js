import { BUILTIN_CODING_PROMPTS } from './coding-prompts.js';
import { GENERATED_PROMPT_CATALOG } from './generated/prompt-catalog.js';

export function getRuntimePromptCatalog({
  builtins = BUILTIN_CODING_PROMPTS,
  canonical = GENERATED_PROMPT_CATALOG,
} = {}) {
  const records = [];
  const seen = new Set();

  for (const prompt of Array.isArray(builtins) ? builtins : []) {
    const record = normalizeRuntimePrompt(prompt, 'builtin');
    assertUnique(record, seen);
    records.push(record);
  }

  for (const prompt of Array.isArray(canonical) ? canonical : []) {
    const record = normalizeRuntimePrompt(prompt, 'canonical');
    assertUnique(record, seen);
    records.push(record);
  }

  return Object.freeze(records);
}

export async function loadCanonicalPromptBody(record, loader = defaultCanonicalLoader) {
  if (!record || record.sourceType !== 'canonical') {
    throw new Error('A canonical prompt record is required.');
  }
  const path = String(record.path || '').trim();
  if (!path || path.includes('..') || path.startsWith('/') || /^[a-z]+:/iu.test(path)) {
    throw new Error(`Canonical prompt path is invalid: ${path || 'missing path'}.`);
  }

  const body = String(await loader(path, record) ?? '').trim();
  if (!body) throw new Error(`Canonical prompt body is empty: ${record.id}.`);
  const bodyId = extractPromptId(body);
  if (!bodyId) throw new Error(`Canonical prompt body has no Metadata ID: ${record.id}.`);
  if (bodyId !== record.id) {
    throw new Error(`Canonical prompt body ID ${bodyId} does not match catalog ID ${record.id}.`);
  }
  return body;
}

export async function resolvePromptBody(record, loader) {
  if (!record) throw new Error('Prompt record is required.');
  if (record.sourceType === 'canonical') return loadCanonicalPromptBody(record, loader);
  const content = String(record.content || '').trim();
  if (!content) throw new Error(`Built-in prompt body is empty: ${record.id}.`);
  return content;
}

function normalizeRuntimePrompt(prompt, sourceType) {
  const id = String(prompt?.id || '').trim();
  const title = String(prompt?.title || prompt?.name || '').trim();
  if (!id) throw new Error('Prompt ID is required.');
  if (!title) throw new Error(`Prompt title is required: ${id}.`);

  const record = {
    id,
    title,
    version: String(prompt.version || '').trim(),
    status: String(prompt.status || 'Stable').trim(),
    category: String(prompt.category || 'Uncategorised').trim(),
    tags: normalizeList(prompt.tags),
    dependencies: normalizeList(prompt.dependencies),
    compatibleProviders: normalizeList(prompt.compatibleProviders),
    relatedPrompts: normalizeList(prompt.relatedPrompts),
    purpose: String(prompt.purpose || prompt.description || '').trim(),
    description: String(prompt.description || prompt.purpose || '').trim(),
    routingIntents: normalizeList(prompt.routingIntents),
    negativeRoutingIntents: normalizeList(prompt.negativeRoutingIntents),
    workModes: normalizeModes(prompt.workModes),
    routingRisk: String(prompt.routingRisk || 'standard').trim().toLowerCase(),
    sourceType,
  };

  if (sourceType === 'canonical') {
    record.path = String(prompt.path || '').trim();
    if (!record.path) throw new Error(`Canonical prompt path is required: ${id}.`);
  } else {
    record.content = String(prompt.content || '').trim();
    if (!record.content) throw new Error(`Built-in prompt content is required: ${id}.`);
  }

  return Object.freeze(record);
}

function assertUnique(record, seen) {
  if (seen.has(record.id)) throw new Error(`Duplicate prompt ID: ${record.id}.`);
  seen.add(record.id);
}

function normalizeList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,;\n]/u);
  return Object.freeze([...new Set(raw.map((item) => String(item).trim()).filter(Boolean))]);
}

function normalizeModes(value) {
  const modes = normalizeList(value).map((item) => item.toLowerCase());
  return Object.freeze(modes.length ? modes : ['ask', 'agent']);
}

function extractPromptId(body) {
  const match = body.match(/^\|\s*ID\s*\|\s*`?([^|`]+)`?\s*\|\s*$/imu);
  return match ? match[1].trim() : '';
}

async function defaultCanonicalLoader(path) {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL || typeof fetch !== 'function') {
    throw new Error('Canonical prompt loading requires the browser-extension runtime or an injected loader.');
  }
  const response = await fetch(chrome.runtime.getURL(path), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Canonical prompt fetch failed (${response.status}): ${path}.`);
  return response.text();
}
