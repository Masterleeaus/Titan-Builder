export interface ResponseTimeouts {
  idleTimeoutMs: number;
  totalTimeoutMs: number;
}

export function resolveResponseTimeouts(
  environment: Record<string, string | undefined>,
): ResponseTimeouts {
  return {
    idleTimeoutMs: clampDuration(
      environment.OPENBROWSER_RESPONSE_IDLE_TIMEOUT_MS,
      180_000,
      30_000,
      600_000,
    ),
    totalTimeoutMs: clampDuration(
      environment.OPENBROWSER_RESPONSE_TIMEOUT_MS,
      900_000,
      60_000,
      3_600_000,
    ),
  };
}

function clampDuration(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}
