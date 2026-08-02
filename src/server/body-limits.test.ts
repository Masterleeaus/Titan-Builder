import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BRIDGE_ROUTE_BODY_LIMITS,
  CONTEXT_PREVIEW_BODY_LIMIT_BYTES,
  OPERATIONS_BODY_LIMIT_BYTES,
  SMALL_BODY_LIMIT_BYTES,
  WORKFLOW_BODY_LIMIT_BYTES,
} from './body-limits.ts';
import { createBridgeServer } from './index.ts';
import { clearSessions } from './session-store.ts';

const CONTROL_TOKEN = 'control-'.padEnd(56, 'a');
const BROWSER_TOKEN = 'browser-'.padEnd(56, 'b');
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnop';

const controlHeaders = {
  authorization: `Bearer ${CONTROL_TOKEN}`,
  'content-type': 'application/json',
};
const browserHeaders = {
  authorization: `Bearer ${BROWSER_TOKEN}`,
  origin: EXTENSION_ORIGIN,
  'content-type': 'application/json',
};

test.beforeEach(() => {
  clearSessions();
});

test('route body-limit catalog covers every JSON body endpoint', () => {
  assert.deepEqual(BRIDGE_ROUTE_BODY_LIMITS, {
    '/projects/register-current': SMALL_BODY_LIMIT_BYTES,
    '/projects/active': SMALL_BODY_LIMIT_BYTES,
    '/project/memory': SMALL_BODY_LIMIT_BYTES,
    '/project/memory/clear': SMALL_BODY_LIMIT_BYTES,
    '/project/context/preview': CONTEXT_PREVIEW_BODY_LIMIT_BYTES,
    '/operations/preview': OPERATIONS_BODY_LIMIT_BYTES,
    '/operations/apply': SMALL_BODY_LIMIT_BYTES,
    '/session': SMALL_BODY_LIMIT_BYTES,
    '/session/prompt': WORKFLOW_BODY_LIMIT_BYTES,
    '/browser/claim': SMALL_BODY_LIMIT_BYTES,
    '/browser/heartbeat': SMALL_BODY_LIMIT_BYTES,
    '/browser/release': SMALL_BODY_LIMIT_BYTES,
    '/browser/chunk': WORKFLOW_BODY_LIMIT_BYTES,
    '/browser/response': WORKFLOW_BODY_LIMIT_BYTES,
    '/browser/message': WORKFLOW_BODY_LIMIT_BYTES,
    '/workspace/runs': WORKFLOW_BODY_LIMIT_BYTES,
    '/workspace/runs/:runId/approve': SMALL_BODY_LIMIT_BYTES,
    '/workspace/runs/:runId/apply': SMALL_BODY_LIMIT_BYTES,
    '/workspace/runs/:runId/reject': SMALL_BODY_LIMIT_BYTES,
    '/workspace/runs/:runId/cancel': SMALL_BODY_LIMIT_BYTES,
  });
  assert.ok(WORKFLOW_BODY_LIMIT_BYTES >= (2_000_000 * 3) + (256 * 1024));
});

test('small, context, operations, and workflow routes enforce exact byte boundaries', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'openbrowser-body-limits-'));
  const app = await createBridgeServer({
    projectRoot,
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
  });
  await app.ready();

  try {
    await assertRouteBoundary({
      app,
      route: '/browser/claim',
      limitBytes: SMALL_BODY_LIMIT_BYTES,
      headers: browserHeaders,
      base: { sessionId: 'missing-session' },
      fillerKey: 'claimantId',
    });

    await assertRouteBoundary({
      app,
      route: '/project/context/preview',
      limitBytes: CONTEXT_PREVIEW_BODY_LIMIT_BYTES,
      headers: controlHeaders,
      base: { refs: [] },
      fillerKey: 'ignoredPadding',
    });

    await assertRouteBoundary({
      app,
      route: '/operations/preview',
      limitBytes: OPERATIONS_BODY_LIMIT_BYTES,
      headers: controlHeaders,
      base: { operations: [] },
      fillerKey: 'ignoredPadding',
    });

    await assertRouteBoundary({
      app,
      route: '/session/prompt',
      limitBytes: WORKFLOW_BODY_LIMIT_BYTES,
      headers: controlHeaders,
      base: {
        mode: 'ask',
        prompt: 'large request',
        systemPrompt: 'system',
        message: '',
        conversationId: 'body-limit-session',
      },
      fillerKey: 'message',
    });
  } finally {
    await app.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('payload-too-large diagnostics report UTF-8 bytes rather than JavaScript characters', async () => {
  const app = await createBridgeServer({
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
  });
  await app.ready();

  try {
    const payload = jsonPayloadAtByteLength(
      { sessionId: 'missing-session' },
      'claimantId',
      SMALL_BODY_LIMIT_BYTES + 1,
      '€',
    );
    assert.ok(payload.length < Buffer.byteLength(payload));

    const response = await app.inject({
      method: 'POST',
      url: '/browser/claim',
      headers: browserHeaders,
      payload,
    });
    assert.equal(response.statusCode, 413);
    assert.deepEqual(response.json(), {
      error: 'Request body exceeds the configured route limit',
      code: 'PAYLOAD_TOO_LARGE',
      route: '/browser/claim',
      observedBytes: Buffer.byteLength(payload),
      limitBytes: SMALL_BODY_LIMIT_BYTES,
    });
  } finally {
    await app.close();
  }
});

async function assertRouteBoundary(options: {
  app: Awaited<ReturnType<typeof createBridgeServer>>;
  route: string;
  limitBytes: number;
  headers: Record<string, string>;
  base: Record<string, unknown>;
  fillerKey: string;
}): Promise<void> {
  for (const targetBytes of [options.limitBytes - 1, options.limitBytes]) {
    const payload = jsonPayloadAtByteLength(options.base, options.fillerKey, targetBytes);
    assert.equal(Buffer.byteLength(payload), targetBytes);
    const response = await options.app.inject({
      method: 'POST',
      url: options.route,
      headers: options.headers,
      payload,
    });
    assert.notEqual(
      response.statusCode,
      413,
      `${options.route} unexpectedly rejected ${targetBytes}/${options.limitBytes} bytes`,
    );
  }

  const payload = jsonPayloadAtByteLength(
    options.base,
    options.fillerKey,
    options.limitBytes + 1,
  );
  const response = await options.app.inject({
    method: 'POST',
    url: options.route,
    headers: options.headers,
    payload,
  });
  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.json(), {
    error: 'Request body exceeds the configured route limit',
    code: 'PAYLOAD_TOO_LARGE',
    route: options.route,
    observedBytes: options.limitBytes + 1,
    limitBytes: options.limitBytes,
  });
}

function jsonPayloadAtByteLength(
  base: Record<string, unknown>,
  fillerKey: string,
  targetBytes: number,
  fillerUnit = 'a',
): string {
  const marker = '__OPENBROWSER_BODY_LIMIT_FILLER__';
  const template = JSON.stringify({ ...base, [fillerKey]: marker });
  const markerBytes = Buffer.byteLength(marker);
  const fixedBytes = Buffer.byteLength(template) - markerBytes;
  const requiredBytes = targetBytes - fixedBytes;
  assert.ok(requiredBytes >= 0, `Target ${targetBytes} is too small for the JSON envelope`);

  const unitBytes = Buffer.byteLength(fillerUnit);
  const unitCount = Math.floor(requiredBytes / unitBytes);
  const remainder = requiredBytes - (unitCount * unitBytes);
  const filler = fillerUnit.repeat(unitCount) + 'a'.repeat(remainder);
  const payload = template.replace(marker, filler);
  assert.equal(Buffer.byteLength(payload), targetBytes);
  return payload;
}
