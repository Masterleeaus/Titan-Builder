import type { FastifyRequest } from 'fastify';

export const SMALL_BODY_LIMIT_BYTES = 64 * 1024;
export const CONTEXT_PREVIEW_BODY_LIMIT_BYTES = 256 * 1024;
export const WORKFLOW_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
export const OPERATIONS_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export const BRIDGE_ROUTE_BODY_LIMITS = {
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
} as const;

export type BridgeBodyRoute = keyof typeof BRIDGE_ROUTE_BODY_LIMITS;

export interface PayloadTooLargeResponse {
  error: 'Request body exceeds the configured route limit';
  code: 'PAYLOAD_TOO_LARGE';
  route: string;
  observedBytes: number;
  limitBytes: number;
}

export function bridgeBodyLimit(route: BridgeBodyRoute): { bodyLimit: number } {
  return { bodyLimit: BRIDGE_ROUTE_BODY_LIMITS[route] };
}

export function isPayloadTooLargeError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE',
  );
}

export function createPayloadTooLargeResponse(
  request: FastifyRequest,
): PayloadTooLargeResponse {
  const route = request.routeOptions.url || request.url.split('?', 1)[0] || request.url;
  const configuredLimit = request.routeOptions.bodyLimit;
  const limitBytes = Number.isSafeInteger(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : SMALL_BODY_LIMIT_BYTES;
  const observedBytes = readContentLength(request.headers['content-length'], limitBytes + 1);

  return {
    error: 'Request body exceeds the configured route limit',
    code: 'PAYLOAD_TOO_LARGE',
    route,
    observedBytes,
    limitBytes,
  };
}

function readContentLength(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
