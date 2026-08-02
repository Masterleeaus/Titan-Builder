export interface RateLimiterOptions {
  windowMs?: number;
  maxFailures?: number;
  penaltyMs?: number;
}

export interface RateLimiter {
  recordFailure(identifier: string): boolean;
  recordSuccess(identifier: string): void;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const windowMs = options.windowMs ?? 60_000;
  const maxFailures = options.maxFailures ?? 10;
  const penaltyMs = options.penaltyMs ?? 5_000;

  const failures = new Map<string, { count: number; firstAtMs: number }>();
  const blocked = new Map<string, number>();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of failures.entries()) {
      if (now - entry.firstAtMs > windowMs) {
        failures.delete(key);
      }
    }
    for (const [key, blockedUntil] of blocked.entries()) {
      if (now > blockedUntil) {
        blocked.delete(key);
      }
    }
  }, 30_000);

  cleanup.unref();

  return {
    recordFailure(identifier: string): boolean {
      const now = Date.now();
      const blockedUntil = blocked.get(identifier);
      if (blockedUntil !== undefined && now < blockedUntil) {
        return false;
      }

      const entry = failures.get(identifier) ?? { count: 0, firstAtMs: now };
      entry.count += 1;
      failures.set(identifier, entry);

      if (entry.count >= maxFailures) {
        blocked.set(identifier, now + penaltyMs);
        failures.delete(identifier);
        return false;
      }

      return true;
    },

    recordSuccess(identifier: string): void {
      failures.delete(identifier);
      blocked.delete(identifier);
    },
  };
}
