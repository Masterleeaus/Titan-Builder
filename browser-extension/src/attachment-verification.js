(() => {
  function normalizeAttachmentName(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .trim()
      .toLowerCase();
  }

  function normalizeEvidenceText(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function createAttachmentExpectation(fileName, size) {
    const normalizedName = normalizeAttachmentName(fileName);
    const markerMatch = normalizedName.match(/^openbrowser-prompt-(.+)\.txt$/);
    return {
      normalizedName,
      marker: markerMatch?.[1] ?? '',
      size: Number.isFinite(Number(size)) ? Number(size) : null,
    };
  }

  function previewEvidenceKey(value, expected) {
    const text = normalizeEvidenceText(value);
    if (!text || !expected?.normalizedName) {
      return null;
    }

    if (containsToken(text, expected.normalizedName)) {
      return `filename:${expected.normalizedName}`;
    }
    if (expected.marker && containsToken(text, expected.marker)) {
      return `marker:${expected.marker}`;
    }
    return null;
  }

  function fileEvidenceKey(file, expected) {
    if (!file || !expected?.normalizedName) {
      return null;
    }
    const normalizedName = normalizeAttachmentName(file.name);
    const size = Number(file.size);
    if (normalizedName !== expected.normalizedName) {
      return null;
    }
    if (expected.size !== null && size !== expected.size) {
      return null;
    }
    return `file:${normalizedName}:${size}`;
  }

  function hasNewAttachmentEvidence(before, after) {
    const beforeKeys = before?.keys ?? new Set();
    const beforeNodes = before?.nodes ?? new Set();
    const afterKeys = after?.keys ?? new Set();
    const afterNodes = after?.nodes ?? new Set();

    for (const key of afterKeys) {
      if (!beforeKeys.has(key)) {
        return true;
      }
    }
    for (const node of afterNodes) {
      if (!beforeNodes.has(node)) {
        return true;
      }
    }
    return false;
  }

  function normalizeComposerText(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''))
      .join('\n')
      .trim();
  }

  function composerContentMatches(actual, expected) {
    const normalizedActual = normalizeComposerText(actual);
    const normalizedExpected = normalizeComposerText(expected);
    return Boolean(normalizedExpected) && normalizedActual === normalizedExpected;
  }

  function containsToken(text, token) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9_-])${escaped}($|[^a-z0-9_-])`, 'i').test(text);
  }

  globalThis.OpenBrowserAttachmentVerification = Object.freeze({
    normalizeAttachmentName,
    createAttachmentExpectation,
    previewEvidenceKey,
    fileEvidenceKey,
    hasNewAttachmentEvidence,
    normalizeComposerText,
    composerContentMatches,
  });
})();
