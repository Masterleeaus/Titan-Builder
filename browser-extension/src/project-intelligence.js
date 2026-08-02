const uniqueStrings = (value) => {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[\n,]/u);
  return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))];
};

export function normalizeProjectRecord(input = {}) {
  const id = String(input.id ?? '').trim();
  const name = String(input.name ?? '').trim();
  const root = String(input.root ?? '').trim();
  if (!id || !name || !root) throw new Error('Invalid project record.');
  return {
    id,
    name,
    root,
    createdAt: String(input.createdAt ?? '').trim(),
    updatedAt: String(input.updatedAt ?? '').trim(),
  };
}

export function normalizeMemoryEntry(input = {}) {
  const id = String(input.id ?? '').trim();
  const text = String(input.text ?? '').trim().replace(/\s+/gu, ' ');
  if (!id || !text) throw new Error('Invalid memory entry.');
  return {
    id,
    text,
    tags: parseMemoryTags(input.tags),
    createdAt: String(input.createdAt ?? '').trim(),
    updatedAt: String(input.updatedAt ?? '').trim(),
  };
}

export function parseMemoryTags(value) {
  return [...new Set(uniqueStrings(value).map((item) => item.toLowerCase()))].sort();
}

export function parseContextRefs(value) {
  return uniqueStrings(value).map((item) => item.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, '') || '.');
}

export function formatContextPreviewSummary(input = {}) {
  const included = Array.isArray(input.included) ? input.included : [];
  const excluded = Array.isArray(input.excluded) ? input.excluded : [];
  const counts = new Map();
  for (const item of excluded) {
    const reason = String(item?.reason ?? 'unknown');
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const excludedSummary = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}:${count}`)
    .join(' · ') || 'none';
  const number = new Intl.NumberFormat('en-US');
  const lines = included.length
    ? included.map((item) => `- ${item.path} · ${number.format(item.characters ?? 0)}/${number.format(item.originalCharacters ?? 0)} chars${item.truncated ? ' · truncated' : ''}`)
    : ['- none'];
  return [
    `Budget: ${number.format(input.totalCharacters ?? 0)}/${number.format(input.limitCharacters ?? 0)} characters`,
    `Included: ${included.length}`,
    ...lines,
    `Excluded: ${excludedSummary}`,
  ].join('\n');
}
