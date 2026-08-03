import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchChatGPTFileExport } from './chatgpt-file-fetch.js';

function streamResponse(chunks, init = {}) {
  let cancelled = false;
  const queue = [...chunks];
  const body = new ReadableStream({
    pull(controller) {
      const next = queue.shift();
      if (next === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(next);
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, init),
    wasCancelled: () => cancelled,
  };
}

test('rejects an announced oversize before consuming the body', async () => {
  const streamed = streamResponse([new Uint8Array([1, 2, 3])], {
    status: 200,
    headers: { 'content-length': '6' },
  });
  let calls = 0;

  await assert.rejects(
    fetchChatGPTFileExport('https://files.oaiusercontent.com/file.bin', {
      maxBytes: 5,
      fetchImplementation: async () => {
        calls += 1;
        return streamed.response;
      },
    }),
    /exceeds the 5 byte export limit/i,
  );

  assert.equal(calls, 1);
  assert.equal(streamed.wasCancelled(), true);
});

test('streams and cancels a chunked response as soon as actual bytes cross the limit', async () => {
  const streamed = streamResponse([
    new Uint8Array([1, 2, 3]),
    new Uint8Array([4, 5, 6]),
    new Uint8Array([7, 8, 9]),
  ], {
    status: 200,
    headers: { 'content-length': '2' },
  });

  await assert.rejects(
    fetchChatGPTFileExport('https://files.oaiusercontent.com/file.bin', {
      maxBytes: 5,
      fetchImplementation: async () => streamed.response,
    }),
    /exceeds the 5 byte export limit/i,
  );

  assert.equal(streamed.wasCancelled(), true);
});

test('allows exactly the byte limit and ignores invalid or understated lengths', async () => {
  const expected = new Uint8Array([1, 2, 3, 4, 5]);
  for (const contentLength of ['1', '-1', 'invalid', '']) {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(expected.subarray(0, 2));
        controller.enqueue(expected.subarray(2));
        controller.close();
      },
    }), {
      status: 200,
      headers: contentLength ? { 'content-length': contentLength } : {},
    });

    const result = await fetchChatGPTFileExport('https://files.oaiusercontent.com/data.bin', {
      maxBytes: 5,
      fetchImplementation: async () => response,
    });

    assert.equal(result.size, 5);
    assert.deepEqual(Uint8Array.from(Buffer.from(result.base64, 'base64')), expected);
  }
});

test('uses credentials only for direct first-party ChatGPT requests and disables redirects', async () => {
  const calls = [];
  const fetchImplementation = async (input, init) => {
    calls.push({
      url: String(input),
      credentials: init.credentials,
      redirect: init.redirect,
    });
    return new Response(new Uint8Array([1]), { status: 200 });
  };

  await fetchChatGPTFileExport('https://chatgpt.com/backend-api/files/abc', {
    fetchImplementation,
  });
  await fetchChatGPTFileExport('https://files.oaiusercontent.com/file.bin', {
    fetchImplementation,
  });

  assert.deepEqual(calls, [
    {
      url: 'https://chatgpt.com/backend-api/files/abc',
      credentials: 'include',
      redirect: 'error',
    },
    {
      url: 'https://files.oaiusercontent.com/file.bin',
      credentials: 'omit',
      redirect: 'error',
    },
  ]);
});

test('rejects every redirect response without contacting a second host', async () => {
  const calls = [];
  const redirected = streamResponse([], {
    status: 302,
    headers: { location: 'https://files.oaiusercontent.com/file.txt' },
  });

  await assert.rejects(
    fetchChatGPTFileExport('https://chatgpt.com/backend-api/files/abc', {
      fetchImplementation: async (input) => {
        calls.push(String(input));
        return redirected.response;
      },
    }),
    /redirects are not permitted/i,
  );

  assert.deepEqual(calls, ['https://chatgpt.com/backend-api/files/abc']);
  assert.equal(redirected.wasCancelled(), true);
});

test('rejects outside, credentialed, and malformed URLs before network access', async () => {
  let calls = 0;
  const fetchImplementation = async () => {
    calls += 1;
    return new Response('unexpected', { status: 200 });
  };

  for (const url of [
    'https://attacker.example/file.bin',
    'http://files.oaiusercontent.com/file.bin',
    'https://user:pass@chatgpt.com/file.bin',
    'not a url',
  ]) {
    await assert.rejects(
      fetchChatGPTFileExport(url, { fetchImplementation }),
      /outside the allowed|invalid/i,
    );
  }

  assert.equal(calls, 0);
});

test('rejects a final response URL that differs from the approved direct request', async () => {
  const response = new Response(new Uint8Array([1]), { status: 200 });
  Object.defineProperty(response, 'url', {
    configurable: true,
    value: 'https://files.oaiusercontent.com/replaced.bin',
  });

  await assert.rejects(
    fetchChatGPTFileExport('https://chatgpt.com/backend-api/files/abc', {
      fetchImplementation: async () => response,
    }),
    /changed URL without an approved direct request/i,
  );
});

test('encodes binary data incrementally without corrupting chunk boundaries', async () => {
  const expected = new Uint8Array([0, 1, 2, 3, 254, 255, 7]);
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(expected.subarray(0, 2));
      controller.enqueue(expected.subarray(2, 5));
      controller.enqueue(expected.subarray(5));
      controller.close();
    },
  }), { status: 200 });

  const result = await fetchChatGPTFileExport('https://files.oaiusercontent.com/data.bin', {
    fetchImplementation: async () => response,
  });

  assert.deepEqual(Uint8Array.from(Buffer.from(result.base64, 'base64')), expected);
  assert.equal(result.size, expected.byteLength);
});

test('aborts a stalled download at the configured deadline', async () => {
  await assert.rejects(
    fetchChatGPTFileExport('https://files.oaiusercontent.com/stalled.bin', {
      timeoutMs: 20,
      fetchImplementation: async (_input, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      }),
    }),
    /timed out/i,
  );
});
