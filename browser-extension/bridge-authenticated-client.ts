import http, { type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import {
  createBridgeChallenge,
  type BridgeIdentityPayload,
  type BridgeIdentityPin,
  verifyBridgeIdentity,
} from './bridge-identity-verifier.js';
import { parseLoopbackBridgeUrl } from './bridge-endpoint-policy.js';

const IDENTITY_RESPONSE_LIMIT_BYTES = 16 * 1024;
const PRIVILEGED_RESPONSE_LIMIT_BYTES = 50 * 1024 * 1024;
const REQUEST_BODY_LIMIT_BYTES = 50 * 1024 * 1024;
const IDENTITY_TIMEOUT_MS = 5_000;
const PRIVILEGED_TIMEOUT_MS = 60_000;

interface BufferedHttpResponse {
  statusCode: number;
  statusMessage: string;
  headers: Headers;
  body: Buffer;
  socket: Socket;
}

export class BridgeClientError extends Error {
  readonly statusCode = 502;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BridgeClientError';
  }
}

export function createAuthenticatedBridgeClient(input: {
  bridgeUrl: string;
  controlToken: string;
}) {
  const baseUrl = parseLoopbackBridgeUrl(input.bridgeUrl);
  const controlToken = input.controlToken.trim();
  if (controlToken.length < 24) {
    throw new Error('Bridge control token must contain at least 24 characters');
  }

  let pinnedIdentity: BridgeIdentityPin | undefined;

  return {
    baseUrl,
    async request(method: string, route: string, body?: unknown): Promise<Response> {
      const target = resolveBridgeRoute(baseUrl, route);
      const bodyText = body === undefined ? undefined : JSON.stringify(body);
      if (bodyText !== undefined && Buffer.byteLength(bodyText, 'utf8') > REQUEST_BODY_LIMIT_BYTES) {
        throw new BridgeClientError('Privileged bridge request exceeded the size limit');
      }

      const agent = new http.Agent({
        keepAlive: true,
        maxSockets: 1,
        maxFreeSockets: 1,
        scheduling: 'lifo',
      });

      try {
        const challenge = createBridgeChallenge();
        const healthUrl = new URL('/health', baseUrl);
        healthUrl.searchParams.set('challenge', challenge);
        const identityResponse = await sendHttpRequest({
          url: healthUrl,
          method: 'GET',
          agent,
          timeoutMs: IDENTITY_TIMEOUT_MS,
          responseLimitBytes: IDENTITY_RESPONSE_LIMIT_BYTES,
          label: 'Bridge identity challenge',
          headers: { Connection: 'keep-alive' },
        });
        rejectRedirect(identityResponse.statusCode, 'Bridge identity challenge');
        if (identityResponse.statusCode < 200 || identityResponse.statusCode >= 300) {
          throw new BridgeClientError(
            `Bridge identity challenge returned HTTP ${identityResponse.statusCode}`,
          );
        }

        let payload: BridgeIdentityPayload;
        try {
          payload = JSON.parse(identityResponse.body.toString('utf8')) as BridgeIdentityPayload;
        } catch {
          throw new BridgeClientError('Bridge identity response was not valid JSON');
        }

        try {
          pinnedIdentity = verifyBridgeIdentity({
            payload,
            challenge,
            controlToken,
            pinned: pinnedIdentity,
          });
        } catch (error) {
          throw new BridgeClientError(
            error instanceof Error ? error.message : 'Bridge identity verification failed',
            error instanceof Error ? { cause: error } : undefined,
          );
        }

        if (identityResponse.socket.destroyed || !identityResponse.socket.writable) {
          throw new BridgeClientError(
            'Authenticated bridge connection closed before the privileged request',
          );
        }

        const privilegedResponse = await sendHttpRequest({
          url: target,
          method,
          agent,
          expectedSocket: identityResponse.socket,
          timeoutMs: PRIVILEGED_TIMEOUT_MS,
          responseLimitBytes: PRIVILEGED_RESPONSE_LIMIT_BYTES,
          label: 'Privileged bridge request',
          headers: {
            Authorization: `Bearer ${controlToken}`,
            Connection: 'close',
            ...(bodyText === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: bodyText,
        });
        rejectRedirect(privilegedResponse.statusCode, 'Privileged bridge request');

        return new Response(privilegedResponse.body, {
          status: privilegedResponse.statusCode,
          statusText: privilegedResponse.statusMessage,
          headers: privilegedResponse.headers,
        });
      } finally {
        agent.destroy();
      }
    },
  };
}

function resolveBridgeRoute(baseUrl: URL, route: string): URL {
  if (!route.startsWith('/') || route.startsWith('//')) {
    throw new BridgeClientError('Bridge route must be an absolute local path');
  }

  const target = new URL(route, baseUrl);
  if (
    target.origin !== baseUrl.origin
    || target.username
    || target.password
    || target.hash
  ) {
    throw new BridgeClientError('Bridge route escaped the authenticated loopback origin');
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
      reject(normalizeClientError(error, input.label));
    };

    const request = http.request(input.url, {
      method: input.method,
      agent: input.agent,
    });

    request.setTimeout(input.timeoutMs, () => {
      request.destroy(new BridgeClientError(`${input.label} timed out`));
    });

    request.once('socket', (socket) => {
      assignedSocket = socket;
      if (
        input.expectedSocket
        && (socket !== input.expectedSocket || socket.destroyed || !socket.writable)
      ) {
        request.destroy(new BridgeClientError(
          'Authenticated bridge connection changed before the privileged request',
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
        request.destroy(normalizeClientError(error, input.label));
      }
    });

    request.once('response', (response) => {
      void (async () => {
        const socket = assignedSocket ?? response.socket;
        if (!socket) {
          response.destroy();
          throw new BridgeClientError(`${input.label} did not expose its connection`);
        }
        if (input.expectedSocket && socket !== input.expectedSocket) {
          response.destroy();
          throw new BridgeClientError(
            'Authenticated bridge connection changed before the privileged response',
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
      throw new BridgeClientError(`${label} exceeded the size limit`);
    }
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > limitBytes) {
      response.destroy();
      throw new BridgeClientError(`${label} exceeded the size limit`);
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
    throw new BridgeClientError(`${label} returned a redirect`);
  }
}

function normalizeClientError(error: unknown, label: string): BridgeClientError {
  if (error instanceof BridgeClientError) return error;
  return new BridgeClientError(
    `${label} failed${error instanceof Error && error.message ? `: ${error.message}` : ''}`,
    error instanceof Error ? { cause: error } : undefined,
  );
}
