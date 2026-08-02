export function parseTemplateVariables(content) {
  const text = String(content ?? '');
  const regex = /\$\{([^}:]+)(?::([^}]*))?\}/g;
  const variables = [];
  const seen = new Set();
  let match;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    variables.push({
      name,
      defaultValue: (match[2] ?? '').trim(),
    });
  }

  return variables;
}

export function applyTemplateVariables(content, values = {}) {
  const text = String(content ?? '');
  return text.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (_match, rawName, rawDefault) => {
    const name = String(rawName).trim();
    const supplied = values[name];
    if (supplied !== undefined && supplied !== null && String(supplied).length > 0) {
      return String(supplied);
    }
    return String(rawDefault ?? '').trim();
  });
}

export function filterPrompts(prompts, query = '', category = 'all') {
  const normalizedQuery = String(query).trim().toLowerCase();
  const normalizedCategory = String(category || 'all').trim().toLowerCase();

  return (Array.isArray(prompts) ? prompts : []).filter((prompt) => {
    const promptCategory = String(prompt.category ?? '').trim().toLowerCase();
    if (normalizedCategory !== 'all' && promptCategory !== normalizedCategory) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const searchable = [
      prompt.title,
      prompt.description,
      prompt.category,
      prompt.content,
      ...(Array.isArray(prompt.tags) ? prompt.tags : []),
    ]
      .map((value) => String(value ?? '').toLowerCase())
      .join(' ');

    return searchable.includes(normalizedQuery);
  });
}

export function normalizeCustomPrompt(value = {}, idFactory = defaultIdFactory) {
  const title = String(value.title ?? '').trim();
  const content = String(value.content ?? '').trim();

  if (!title) {
    throw new Error('Custom prompt title is required.');
  }
  if (!content) {
    throw new Error('Custom prompt content is required.');
  }

  const description = String(value.description ?? '').trim();
  const category = String(value.category ?? 'Custom').trim() || 'Custom';
  const rawTags = Array.isArray(value.tags)
    ? value.tags
    : String(value.tags ?? '')
        .split(',');

  const tags = [...new Set(rawTags.map((tag) => String(tag).trim()).filter(Boolean))];

  return {
    id: String(value.id ?? '').trim() || idFactory(),
    title,
    description,
    category,
    tags,
    content,
    custom: true,
  };
}

function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
