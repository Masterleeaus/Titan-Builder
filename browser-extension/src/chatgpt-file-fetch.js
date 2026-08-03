const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const BASE64_BINARY_CHUNK_BYTES = 24 * 1024;
const FIRST_PARTY_CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

export async function fetchChatGPTFileExport(rawUrl, options = {}) {
  const maxBytes = normalizePositiveInteger(options.maxBytes, DEFAULT_MAX_BYTES, 'maxBytes');
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const fetchImplementation = options.fetchImplementation ?? fetch;
  if (typeof fetchImplementation !== 'function') {
    throw new TypeError('fetchImplementation must be a function.');
  }

  const requestedUrl = parseAllowedChatGPTFileUrl(rawUrl, options.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('ChatGPT file download timed out.'));
  }, timeoutMs);

  try {
    const response = await fetchImplementation(requestedUrl.href, {
      credentials: credentialsForUrl(requestedUrl),
      redirect: 'error',
      signal: controller.signal,
    });

    if (!(response instanceof Response)) {
      throw new TypeError('ChatGPT file download returned an invalid response.');
    }

    if (response.redirected || response.type === 'opaqueredirect' || isRedirectStatus(response.status)) {
      await cancelResponseBody(response);
      throw new Error('ChatGPT file download redirects are not permitted.');
    }

    validateFinalResponseUrl(response, requestedUrl);

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`File download failed (${response.status}).`);
    }

    const announcedSize = parseContentLength(response.headers.get('content-length'));
    if (announcedSize !== undefined && announcedSize > maxBytes) {
      await cancelResponseBody(response);
      throw exportLimitError(maxBytes);
    }

    const { base64, size } = await readBoundedResponseBody(response, maxBytes);
    const disposition = response.headers.get('content-disposition') ?? '';

    return {
      base64,
      filename: deriveFilename(disposition, requestedUrl),
      type: response.headers.get('content-type') ?? 'application/octet-stream',
      size,
    };
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export function parseAllowedChatGPTFileUrl(rawUrl, baseUrl) {
  let url;
  try {
    url = baseUrl === undefined
      ? new URL(String(rawUrl ?? ''))
      : new URL(String(rawUrl ?? ''), String(baseUrl));
  } catch (error) {
    throw new Error('The ChatGPT file URL is invalid.', { cause: error });
  }

  const hostname = url.hostname.toLowerCase();
  const allowedHost = FIRST_PARTY_CHATGPT_HOSTS.has(hostname)
    || hostname === 'files.oaiusercontent.com'
    || hostname.endsWith('.oaiusercontent.com');
  if (url.protocol !== 'https:' || !allowedHost || url.username || url.password) {
    throw new Error('The file URL is outside the allowed ChatGPT file hosts.');
  }
  return url;
}

function validateFinalResponseUrl(response, requestedUrl) {
  if (!response.url) return;
  const finalUrl = parseAllowedChatGPTFileUrl(response.url);
  if (finalUrl.href !== requestedUrl.href) {
    throw new Error('ChatGPT file download changed URL without an approved direct request.');
  }
}

function credentialsForUrl(url) {
  return FIRST_PARTY_CHATGPT_HOSTS.has(url.hostname.toLowerCase()) ? 'include' : 'omit';
}

async function readBoundedResponseBody(response, maxBytes) {
  if (!response.body) {
    return { base64: '', size: 0 };
  }

  const reader = response.body.getReader();
  const encodedParts = [];
  let carry = new Uint8Array(0);
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new Error('ChatGPT file download returned an invalid byte stream.');
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw exportLimitError(maxBytes);
      }

      let bytes = value;
      if (carry.byteLength > 0) {
        const combined = new Uint8Array(carry.byteLength + value.byteLength);
        combined.set(carry, 0);
        combined.set(value, carry.byteLength);
        bytes = combined;
      }

      const completeLength = bytes.byteLength - (bytes.byteLength % 3);
      if (completeLength > 0) {
        encodedParts.push(encodeCompleteBase64Bytes(bytes.subarray(0, completeLength)));
      }
      carry = bytes.slice(completeLength);
    }

    if (carry.byteLength > 0) {
      encodedParts.push(btoa(bytesToBinary(carry)));
    }

    return {
      base64: encodedParts.join(''),
      size: totalBytes,
    };
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The stream may already be closed or aborted.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function cancelResponseBody(response) {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // The stream may already be locked, closed, or aborted.
  }
}

function encodeCompleteBase64Bytes(bytes) {
  const output = [];
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_BINARY_CHUNK_BYTES) {
    const end = Math.min(bytes.byteLength, offset + BASE64_BINARY_CHUNK_BYTES);
    output.push(btoa(bytesToBinary(bytes.subarray(offset, end))));
  }
  return output.join('');
}

function bytesToBinary(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return binary;
}

function deriveFilename(disposition, url) {
  const extended = /filename\*=UTF-8''([^;]+)/iu.exec(disposition)?.[1];
  const quoted = /filename="([^"]+)"/iu.exec(disposition)?.[1];
  const plain = /filename=([^;]+)/iu.exec(disposition)?.[1];
  const pathName = url.pathname.split('/').filter(Boolean).pop() ?? 'chatgpt-file';
  const candidate = safeDecodeURIComponent(extended ?? quoted ?? plain ?? pathName)
    .trim()
    .replace(/[\\/\0-\x1f\x7f]/gu, '-');
  return candidate || 'chatgpt-file';
}

function safeDecodeURIComponent(value) {
  const normalized = String(value ?? '').trim().replace(/^"|"$/gu, '');
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function parseContentLength(value) {
  if (value === null || value === '') return undefined;
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}

function isRedirectStatus(status) {
  return status >= 300 && status < 400;
}

function exportLimitError(maxBytes) {
  return new Error(`File exceeds the ${maxBytes} byte export limit.`);
}

function normalizePositiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}
