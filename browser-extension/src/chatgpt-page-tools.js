(() => {
  const FILE_EXTENSIONS = /\.(?:md|txt|json|csv|tsv|pdf|docx?|xlsx?|pptx?|zip|tar|gz|js|mjs|cjs|ts|tsx|jsx|css|html?|xml|ya?ml|py|php|java|c|cc|cpp|h|hpp|rs|go|sql|sh|ps1)(?:$|[?#])/i;
  const GENERIC_APP_LABELS = new Set([
    'settings', 'search', 'search plugins', 'search apps', 'plugins', 'apps', 'explore',
    'library', 'new chat', 'chatgpt', 'close', 'open', 'install', 'installed', 'more',
  ]);

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function safeUrl(value) {
    try {
      return new URL(String(value ?? ''), globalThis.location?.href ?? 'https://chatgpt.com/').href;
    } catch {
      return '';
    }
  }

  function filenameFromUrl(href) {
    const url = safeUrl(href);
    if (!url) return '';
    try {
      const pathname = decodeURIComponent(new URL(url).pathname);
      const part = pathname.split('/').filter(Boolean).pop() ?? '';
      return FILE_EXTENSIONS.test(part) ? part.replace(/[?#].*$/, '') : '';
    } catch {
      return '';
    }
  }

  function classifyAppCandidate({ text = '', href = '' } = {}) {
    const name = cleanText(text).replace(/\b(?:installed|plugin|app)\b$/i, '').trim();
    const url = safeUrl(href);
    if (!name || name.length < 2 || name.length > 100) return null;
    if (GENERIC_APP_LABELS.has(name.toLowerCase())) return null;
    if (/^(?:search|open|close|install|uninstall|configure)\b/i.test(name)) return null;
    const appLikeUrl = /chatgpt\.com\/(?:g\/|gpts|apps|plugins)|chat\.openai\.com\/(?:g\/|gpts|apps|plugins)/i.test(url);
    const appLikeText = /\b(?:plugin|app|connector)\b/i.test(cleanText(text));
    if (!appLikeUrl && !appLikeText) return null;
    return { type: 'app', name, url, source: 'visible-chatgpt-page' };
  }

  function classifyFileCandidate({ text = '', href = '', download = '' } = {}) {
    const label = cleanText(download || text);
    const url = safeUrl(href);
    let name = FILE_EXTENSIONS.test(label) ? label.match(/[^/\\]+\.[A-Za-z0-9]{1,8}(?=$|\s)/)?.[0] ?? label : '';
    if (!name) name = filenameFromUrl(url);
    if (!name && /(?:backend-api\/files|files\.oaiusercontent\.com|download)/i.test(url)) {
      const match = cleanText(text).match(/[\w .()\-]+\.[A-Za-z0-9]{1,8}/);
      name = match?.[0]?.trim() ?? '';
    }
    if (!name || !FILE_EXTENSIONS.test(name)) return null;
    return {
      type: 'file',
      name: name.replace(/[?#].*$/, ''),
      url,
      source: 'visible-chatgpt-page',
    };
  }

  function dedupeItems(items = []) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
      if (!item) continue;
      const key = `${item.type ?? ''}|${String(item.name ?? item.title ?? '').toLowerCase()}|${item.url ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
    return output;
  }

  function isVisible(element) {
    if (!element?.getBoundingClientRect) return true;
    const rect = element.getBoundingClientRect();
    const style = globalThis.getComputedStyle?.(element);
    return rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden';
  }

  function scanVisibleApps(root = globalThis.document) {
    if (!root?.querySelectorAll) return [];
    const candidates = [];
    for (const element of root.querySelectorAll('a[href], button, [role="button"], [data-testid]')) {
      if (!isVisible(element)) continue;
      const item = classifyAppCandidate({
        text: element.innerText ?? element.textContent ?? element.getAttribute?.('aria-label') ?? '',
        href: element.href ?? element.getAttribute?.('href') ?? '',
      });
      if (item) candidates.push(item);
    }
    return dedupeItems(candidates);
  }

  function scanVisibleFiles(root = globalThis.document) {
    if (!root?.querySelectorAll) return [];
    const candidates = [];
    for (const element of root.querySelectorAll('a[href], [download], button, [role="button"]')) {
      if (!isVisible(element)) continue;
      const item = classifyFileCandidate({
        text: element.innerText ?? element.textContent ?? element.getAttribute?.('aria-label') ?? '',
        href: element.href ?? element.getAttribute?.('href') ?? '',
        download: element.download ?? element.getAttribute?.('download') ?? '',
      });
      if (item) candidates.push(item);
    }
    return dedupeItems(candidates);
  }

  function scanConversationReplies(root = globalThis.document) {
    if (!root?.querySelectorAll) return [];
    let nodes = [...root.querySelectorAll('[data-message-author-role="assistant"]')];
    if (!nodes.length) nodes = [...root.querySelectorAll('article[data-testid^="conversation-turn-"]')];
    const replies = [];
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      const text = String(node.innerText ?? node.textContent ?? '').replace(/\r\n/g, '\n').trim();
      if (!text || text.length < 2) continue;
      const id = `reply-${replies.length + 1}`;
      replies.push({
        type: 'reply',
        id,
        name: `Assistant reply ${replies.length + 1}`,
        text,
        url: globalThis.location?.href ?? '',
        source: 'visible-conversation',
      });
    }
    const seenText = new Set();
    return replies.filter((item) => {
      const key = item.text.slice(0, 5000);
      if (seenText.has(key)) return false;
      seenText.add(key);
      return true;
    });
  }


  globalThis.OpenBrowserChatGPTTools = Object.freeze({
    classifyAppCandidate,
    classifyFileCandidate,
    dedupeItems,
    scanVisibleApps,
    scanVisibleFiles,
    scanConversationReplies,
  });
})();
