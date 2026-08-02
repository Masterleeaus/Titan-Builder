import crypto from 'node:crypto';

export type BridgeRouteScope = 'public' | 'browser' | 'control' | 'shared';

export interface BridgeSecurityPolicyOptions {
  controlToken?: string;
  browserToken?: string;
  allowedExtensionOrigins?: string[];
  allowInsecureDev?: boolean;
}

export interface BridgeAuthorizationInput {
  scope: BridgeRouteScope;
  authorization?: string;
  origin?: string;
}

export interface BridgeSecurityPolicy {
  authorize(input: BridgeAuthorizationInput): boolean;
  isAllowedPreflightOrigin(origin?: string): boolean;
  allowedExtensionOrigins(): string[];
}

const MIN_TOKEN_CHARACTERS = 32;
const EXTENSION_ORIGIN_PATTERN = /^(?:chrome|moz)-extension:\/\/[A-Za-z0-9_-]+$/u;

export function createBridgeSecurityPolicy(
  options: BridgeSecurityPolicyOptions,
): BridgeSecurityPolicy {
  const allowInsecureDev = options.allowInsecureDev === true;
  const controlToken = normalizeToken(options.controlToken);
  const browserToken = normalizeToken(options.browserToken);

  if (!allowInsecureDev) {
    assertStrongToken(controlToken, 'Control');
    assertStrongToken(browserToken, 'Browser');
    if (constantTimeEqual(controlToken, browserToken)) {
      throw new Error('Control and browser tokens must be different');
    }
  }

  const configuredOrigins = normalizeOrigins(options.allowedExtensionOrigins ?? []);
  let pinnedOrigin: string | undefined;

  const currentOrigins = (): string[] => (
    configuredOrigins.length > 0
      ? [...configuredOrigins]
      : pinnedOrigin
        ? [pinnedOrigin]
        : []
  );

  const extensionOriginAllowed = (origin: string, pinIfEmpty: boolean): boolean => {
    if (!isExtensionOrigin(origin)) {
      return false;
    }
    if (configuredOrigins.length > 0) {
      return configuredOrigins.includes(origin);
    }
    if (!pinnedOrigin && pinIfEmpty) {
      pinnedOrigin = origin;
    }
    return !pinnedOrigin || pinnedOrigin === origin;
  };

  return {
    authorize(input): boolean {
      const origin = normalizeOrigin(input.origin);
      if (origin && !isExtensionOrigin(origin)) {
        return false;
      }

      if (input.scope === 'public') {
        return !origin || extensionOriginAllowed(origin, false);
      }

      if (allowInsecureDev) {
        return !origin || extensionOriginAllowed(origin, true);
      }

      const principal = authenticateBearer(
        input.authorization,
        controlToken,
        browserToken,
      );
      if (!principal) {
        return false;
      }

      if (origin) {
        if (principal !== 'browser') {
          return false;
        }
        if (!extensionOriginAllowed(origin, true)) {
          return false;
        }
      }

      switch (input.scope) {
        case 'browser':
          return principal === 'browser';
        case 'control':
          return principal === 'control';
        case 'shared':
          return principal === 'control' || principal === 'browser';
        default:
          return false;
      }
    },

    isAllowedPreflightOrigin(origin): boolean {
      const normalized = normalizeOrigin(origin);
      if (!normalized) {
        return true;
      }
      if (!isExtensionOrigin(normalized)) {
        return false;
      }
      if (configuredOrigins.length > 0) {
        return configuredOrigins.includes(normalized);
      }
      return !pinnedOrigin || pinnedOrigin === normalized;
    },

    allowedExtensionOrigins: currentOrigins,
  };
}

export function resolveBridgeRouteScope(method: string, rawUrl: string): BridgeRouteScope {
  const url = rawUrl.split('?')[0] ?? rawUrl;
  if (method.toUpperCase() === 'OPTIONS' || url === '/health') {
    return 'public';
  }
  if (url === '/browser/events' || url.startsWith('/browser/')) {
    return 'browser';
  }
  if (url.startsWith('/operations/') || url.startsWith('/session')) {
    return 'control';
  }
  if (
    url === '/project/status' ||
    url === '/projects' ||
    url.startsWith('/projects/') ||
    url === '/summary' ||
    url.startsWith('/project/')
  ) {
    return 'shared';
  }
  return 'control';
}

export function parseAllowedExtensionOrigins(value?: string): string[] {
  if (!value?.trim()) {
    return [];
  }
  return normalizeOrigins(value.split(','));
}

function authenticateBearer(
  authorization: string | undefined,
  controlToken: string,
  browserToken: string,
): 'control' | 'browser' | null {
  const prefix = 'Bearer ';
  const actual = authorization ?? '';
  if (!actual.startsWith(prefix)) {
    return null;
  }
  const token = actual.slice(prefix.length);
  if (constantTimeEqual(token, controlToken)) {
    return 'control';
  }
  if (constantTimeEqual(token, browserToken)) {
    return 'browser';
  }
  return null;
}

function assertStrongToken(token: string, label: string): void {
  if (!token) {
    throw new Error(`${label} token is required`);
  }
  if (token.length < MIN_TOKEN_CHARACTERS) {
    throw new Error(`${label} token must be at least ${MIN_TOKEN_CHARACTERS} characters`);
  }
}

function normalizeToken(value?: string): string {
  return String(value ?? '').trim();
}

function normalizeOrigins(values: string[]): string[] {
  const origins = values
    .map(normalizeOrigin)
    .filter((value): value is string => Boolean(value));
  for (const origin of origins) {
    if (!isExtensionOrigin(origin)) {
      throw new Error(`Invalid extension origin: ${origin}`);
    }
  }
  return [...new Set(origins)].sort();
}

function normalizeOrigin(value?: string): string | undefined {
  const normalized = String(value ?? '').trim().replace(/\/$/u, '');
  return normalized || undefined;
}

function isExtensionOrigin(origin: string): boolean {
  return EXTENSION_ORIGIN_PATTERN.test(origin);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}
