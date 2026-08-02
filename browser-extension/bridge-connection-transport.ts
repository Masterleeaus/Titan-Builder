import http, { type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import {
  createBridgeIdentityNonce,
  MAX_IDENTITY_RESPONSE_BYTES,
  type TrustedBridgeEndpoint,
  verifyBridgeIdentityPayload,
} from './bridge-trust.js';

const MAX_PRIVILEGED_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 50 * 1024 * 1024;
const IDENTITY_TIMEOUT_MS = 10_000;
const PRIVILEGED_TIMEOUT_MS = 60_000;
const NULL_BODY_STATUS_CODES = new Set([204, 205, 304]);

interface BufferedHttpResponse {
  statusCode: number;
  statusMessage: string;
  headers: Headers;
  body: Buffer;
  socket: Socket;
}

export class BridgeConnectionError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BridgeConnectionError';
    this.statusCode = statusCode;
  }
}

export interface AuthenticatedBridgeRequest {
  endpoint: TrustedBridgeEndpoint;
  controlToken: string;
  method: string;
  route: string;
  body?: unknown;
}

export async function requestAuthenticatedBridge(
  input: AuthenticatedBridgeRequest,
): Promise<Response> {
  if (!input.controlToken) {
    throw new BridgeConnectionError(
      'BRIDGE_TOKEN is required to authenticate the local bridge.',
      503,
    );
  }

  const target = resolveBridgeRoute(input.endpoint, input.route);
  const bodyText = input.body === undefined ? undefined : JSON.stringify(input.body);
  if (bodyText !== undefined && Buffer.byteLength(bodyText, 'utf8') > MAX_REQUEST_BODY_BYTES) {
    throw new BridgeConnectionError('Privileged bridge request exceeded the size limit.', 413);
  }

  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: 1,
    maxFreeSockets: 1,
    scheduling: 'lifo',
  });

  try {
    const nonce = createBridgeIdentityNonce();
    const identityUrl = new URL('/bridge/identity', input.endpoint.origin);
    identityUrl.searchParams.set('nonce', nonce);
    const identityResponse = await sendHttpRequest({
      url: identityUrl,
      method: 'GET',
      agent,
      timeoutMs: IDENTITY_TIMEOUT_MS,
      responseLimitBytes: MAX_IDENTITY_RESPONSE_BYTES,
      label: 'Bridge identity challenge',
      headers: { Connection: 'keep-alive' },
    });
    rejectRedirect(identityResponse.statusCode, 'Bridge identity challenge');
    if (identityResponse.statusCode < 200 || identityResponse.statusCode >= 300) {
      throw new BridgeConnectionError(
        `Bridge identity challenge failed with HTTP ${identityResponse.statusCode}.`,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(identityResponse.body.toString('utf8')) as unknown;
    } catch (error) {
      throw new BridgeConnectionError(
        'Bridge identity challenge returned invalid JSON.',
        502,
        error instanceof Error ? { cause: error } : undefined,
      );
    }

    try {
      verifyBridgeIdentityPayload(
        input.endpoint,
        input.controlToken,
        nonce,
        payload,
      );
    } catch (error) {
      throw normalizeConnectionError(error, 'Bridge identity verification');
    }

    const identityConnection = identityResponse.headers.get('connection')
      ?.split(',')
      .map((value) => value.trim().toLowerCase());
    if (
      identityConnection?.includes('close')
      || identityResponse.socket.destroyed
      || !identityResponse.socket.writable
    ) {
      throw new BridgeConnectionError(
        'Authenticated bridge connection closed before bearer delivery.',
      );
    }

    const privilegedResponse = await sendHttpRequest({
      url: target,
      method: input.method,
      agent,
      expectedSocket: identityResponse.socket,
      timeoutMs: PRIVILEGED_TIMEOUT_MS,
      responseLimitBytes: MAX_PRIVILEGED_RESPONSE_BYTES,
      label: 'Privileged bridge request',
      headers: {
        Authorization: `Bearer ${input.controlToken}`,
        Connection: 'close',
        ...(bodyText === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: bodyText,
    });
    rejectRedirect(privilegedResponse.statusCode, 'Privileged bridge request');

    return new Response(
      NULL_BODY_STATUS_CODES.has(privilegedResponse.statusCode)
        ? null
        : privilegedResponse.body,
      {
        status: privilegedResponse.statusCode,
        statusText: privilegedResponse.statusMessage,
        headers: privilegedResponse.headers,
      },
    );
  } finally {
    agent.destroy();
  }
}

function resolveBridgeRoute(endpoint: TrustedBridgeEndpoint, route: string): URL {
  if (!route.startsWith('/') || route.startsWith('//')) {
    throw new BridgeConnectionError('Bridge route must be an absolute local path.', 400);
  }

  const target = new URL(route, endpoint.origin);
  if (
    target.origin !== endpoint.origin
    || target.username
    || target.password
    || target.hash
  ) {
    throw new BridgeConnectionError('Bridge route escaped the authenticated loopback origin.', 400);
  }
  return target;
}

function sendHttpRequest(input: {
  url: URL;
  method: string;
  agent: http.Agent;
  expectedSocket?: Socket;
  timeoutMs: number;
  responseLimitBytes: number;
  label: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<BufferedHttpResponse> {
  return new Promise((resolve, reject) => {
    let assignedSocket: Socket | undefined;
    let settled = false;

    const finishReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(normalizeConnectionError(error, input.label));
    };

    const request = http.request(input.url, {
      method: input.method,
      agent: input.agent,
    });

    request.setTimeout(input.timeoutMs, () => {
      request.destroy(new BridgeConnectionError(`${input.label} timed out.`));
    });

    request.once('socket', (socket) => {
      assignedSocket = socket;
      if (
        input.expectedSocket
        && (socket !== input.expectedSocket || socket.destroyed || !socket.writable)
      ) {
        request.destroy(new BridgeConnectionError(
          'Authenticated bridge connection changed before bearer delivery.',
        ));
        return;
      }

      try {
        for (const [name, value] of Object.entries(input.headers ?? {})) {
          request.setHeader(name, value);
        }
        if (input.body !== undefined) {
          request.setHeader('Content-Length', String(Buffer.byteLength(input.body, 'utf8')));
          request.end(input.body, 'utf8');
        } else {
          request.end();
        }
      } catch (error) {
        request.destroy(normalizeConnectionError(error, input.label));
      }
    });

    request.once('response', (response) => {
      void (async () => {
        const socket = assignedSocket ?? response.socket;
        if (!socket) {
          response.destroy();
          throw new BridgeConnectionError(`${input.label} did not expose its connection.`);
        }
        if (input.expectedSocket && socket !== input.expectedSocket) {
          response.destroy();
          throw new BridgeConnectionError(
            'Authenticated bridge connection changed before the privileged response.',
          );
        }

        const body = await readBoundedBody(
          response,
          input.responseLimitBytes,
          input.label,
        );
        if (settled) return;
        settled = true;
        resolve({
          statusCode: response.statusCode ?? 500,
          statusMessage: response.statusMessage ?? '',
          headers: toWebHeaders(response),
          body,
          socket,
        });
      })().catch(finishReject);
    });

    request.once('error', finishReject);
  });
}

async function readBoundedBody(
  response: IncomingMessage,
  limitBytes: number,
  label: string,
): Promise<Buffer> {
  const announcedLength = response.headers['content-length'];
  if (typeof announcedLength === 'string') {
    const parsedLength = Number(announcedLength);
    if (Number.isFinite(parsedLength) && parsedLength > limitBytes) {
      response.destroy();
      throw new BridgeConnectionError(`${label} exceeded the size limit.`);
    }
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > limitBytes) {
      response.destroy();
      throw new BridgeConnectionError(`${label} exceeded the size limit.`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, totalBytes);
}

function toWebHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (name && value !== undefined) headers.append(name, value);
  }
  return headers;
}

function rejectRedirect(statusCode: number, label: string): void {
  if (statusCode >= 300 && statusCode < 400) {
    throw new BridgeConnectionError(`${label} returned a redirect.`);
  }
}

function normalizeConnectionError(error: unknown, label: string): BridgeConnectionError {
  if (error instanceof BridgeConnectionError) return error;
  const statusCode = readStatusCode(error) ?? 502;
  return new BridgeConnectionError(
    `${label} failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
    statusCode,
    error instanceof Error ? { cause: error } : undefined,
  );
}

function readStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return undefined;
  const candidate = (error as { statusCode?: unknown }).statusCode;
  return typeof candidate === 'number'
    && Number.isInteger(candidate)
    && candidate >= 400
    && candidate <= 599
    ? candidate
    : undefined;
}
