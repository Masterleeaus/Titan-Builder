import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchChatGPTFileExport } from './chatgpt-file-fetch.js';

function streamResponse(chunks, init = {}) {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      const next = chunks.shift();
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

test('streams and cancels a chunked response as soon as it crosses the limit', async () => {
  const streamed = streamResponse([
    new Uint8Array([1, 2, 3]),
    new Uint8Array([4, 5, 6]),
    new Uint8Array([7, 8, 9]),
  ], { status: 200 });

  await assert.rejects(
    fetchChatGPTFileExport('https://files.oaiusercontent.com/file.bin', {
      maxBytes: 5,
      fetchImplementation: async () => streamed.response,
    }),
    /exceeds the 5 byte export limit/i,
  );

  assert.equal(streamed.wasCancelled(), true);
});

test('follows only allowed redirects and drops credentials on the CDN hop', async () => {
  const calls = [];
  const fileBytes = new TextEncoder().encode('hello');

  const result = await fetchChatGPTFileExport('https://chatgpt.com/backend-api/files/abc', {
    fetchImplementation: async (input, init) => {
      const url = String(input);
      calls.push({ url, credentials: init.credentials, redirect: init.redirect });
      if (url.startsWith('https://chatgpt.com/')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://files.oaiusercontent.com/file.txt' },
        });
      }
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(fileBytes);
          controller.close();
        },
      }), {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'content-disposition': 'attachment; filename="result.txt"',
        },
      });
    },
  });

  assert.deepEqual(calls, [
    {
      url: 'https://chatgpt.com/backend-api/files/abc',
      credentials: 'include',
      redirect: 'manual',
    },
    {
      url: 'https://files.oaiusercontent.com/file.txt',
      credentials: 'omit',
      redirect: 'manual',
    },
  ]);
  assert.equal(result.base64, 'aGVsbG8=');
  assert.equal(result.filename, 'result.txt');
  assert.equal(result.type, 'text/plain');
  assert.equal(result.size, 5);
});

test('rejects a redirect outside the ChatGPT file allowlist before contacting it', async () => {
  const calls = [];
  const redirect = streamResponse([], {
    status: 302,
    headers: { location: 'https://attacker.example/steal' },
  });

  await assert.rejects(
    fetchChatGPTFileExport('https://chatgpt.com/backend-api/files/abc', {
      fetchImplementation: async (input) => {
        calls.push(String(input));
        return redirect.response;
      },
    }),
    /outside the allowed ChatGPT file hosts/i,
  );

  assert.deepEqual(calls, ['https://chatgpt.com/backend-api/files/abc']);
  assert.equal(redirect.wasCancelled(), true);
});

test('rejects redirect loops and excessive redirect chains', async () => {
  let loopCalls = 0;
  await assert.rejects(
    fetchChatGPTFileExport('https://chatgpt.com/file', {
      fetchImplementation: async () => {
        loopCalls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://chatgpt.com/file' },
        });
      },
    }),
    /redirect loop/i,
  );
  assert.equal(loopCalls, 1);

  let chainCalls = 0;
  await assert.rejects(
    fetchChatGPTFileExport('https://chatgpt.com/start', {
      maxRedirects: 1,
      fetchImplementation: async () => {
        chainCalls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: `https://chatgpt.com/step-${chainCalls}` },
        });
      },
    }),
    /too many redirects/i,
  );
  assert.equal(chainCalls, 2);
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

  assert.deepEqual(
    Uint8Array.from(Buffer.from(result.base64, 'base64')),
    expected,
  );
});
