import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBridgeSecurityPolicy,
  resolveBridgeRouteScope,
} from './security.ts';

const CONTROL_TOKEN = 'control-'.padEnd(56, 'a');
const BROWSER_TOKEN = 'browser-'.padEnd(56, 'b');
const EXTENSION_A = 'chrome-extension://abcdefghijklmnop';
const EXTENSION_B = 'chrome-extension://qrstuvwxyzabcdef';

test('security policy requires distinct strong control and browser tokens by default', () => {
  assert.throws(
    () => createBridgeSecurityPolicy({ controlToken: '', browserToken: BROWSER_TOKEN }),
    /control token is required/i,
  );
  assert.throws(
    () => createBridgeSecurityPolicy({ controlToken: 'short', browserToken: BROWSER_TOKEN }),
    /at least 32 characters/i,
  );
  assert.throws(
    () => createBridgeSecurityPolicy({ controlToken: CONTROL_TOKEN, browserToken: CONTROL_TOKEN }),
    /must be different/i,
  );
});

test('route scopes separate browser lifecycle from privileged control endpoints', () => {
  assert.equal(resolveBridgeRouteScope('GET', '/health'), 'public');
  assert.equal(resolveBridgeRouteScope('GET', '/bridge/identity?nonce=abc'), 'public');
  assert.equal(resolveBridgeRouteScope('POST', '/browser/claim'), 'browser');
  assert.equal(resolveBridgeRouteScope('GET', '/browser/events?cursor=1'), 'browser');
  assert.equal(resolveBridgeRouteScope('POST', '/operations/preview'), 'control');
  assert.equal(resolveBridgeRouteScope('POST', '/operations/apply'), 'control');
  assert.equal(resolveBridgeRouteScope('POST', '/session/prompt'), 'control');
  assert.equal(resolveBridgeRouteScope('GET', '/tools'), 'shared');
  assert.equal(resolveBridgeRouteScope('GET', '/project/status'), 'shared');
  assert.equal(resolveBridgeRouteScope('POST', '/project/memory'), 'shared');
});

test('browser token cannot invoke control routes and control token is not accepted from extension pages', () => {
  const policy = createBridgeSecurityPolicy({
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
  });

  assert.equal(policy.authorize({
    scope: 'control',
    authorization: `Bearer ${CONTROL_TOKEN}`,
  }), true);
  assert.equal(policy.authorize({
    scope: 'control',
    authorization: `Bearer ${BROWSER_TOKEN}`,
  }), false);
  assert.equal(policy.authorize({
    scope: 'control',
    authorization: `Bearer ${CONTROL_TOKEN}`,
    origin: EXTENSION_A,
  }), false);
  assert.equal(policy.authorize({
    scope: 'browser',
    authorization: `Bearer ${BROWSER_TOKEN}`,
    origin: EXTENSION_A,
  }), true);
  assert.equal(policy.authorize({
    scope: 'shared',
    authorization: `Bearer ${BROWSER_TOKEN}`,
    origin: EXTENSION_A,
  }), true);
  assert.equal(policy.authorize({
    scope: 'shared',
    authorization: `Bearer ${CONTROL_TOKEN}`,
  }), true);
});

test('first authenticated extension origin is pinned for the server lifetime', () => {
  const policy = createBridgeSecurityPolicy({
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
  });

  assert.equal(policy.isAllowedPreflightOrigin(EXTENSION_A), true);
  assert.equal(policy.isAllowedPreflightOrigin(EXTENSION_B), true);
  assert.equal(policy.authorize({
    scope: 'browser',
    authorization: `Bearer ${BROWSER_TOKEN}`,
    origin: EXTENSION_A,
  }), true);
  assert.equal(policy.authorize({
    scope: 'browser',
    authorization: `Bearer ${BROWSER_TOKEN}`,
    origin: EXTENSION_B,
  }), false);
  assert.deepEqual(policy.allowedExtensionOrigins(), [EXTENSION_A]);
});

test('configured extension-origin allowlist is exact and normal web origins are always rejected', () => {
  const policy = createBridgeSecurityPolicy({
    controlToken: CONTROL_TOKEN,
    browserToken: BROWSER_TOKEN,
    allowedExtensionOrigins: [EXTENSION_A],
  });

  assert.equal(policy.isAllowedPreflightOrigin(EXTENSION_A), true);
  assert.equal(policy.isAllowedPreflightOrigin(EXTENSION_B), false);
  assert.equal(policy.isAllowedPreflightOrigin('https://chatgpt.com'), false);
  assert.equal(policy.authorize({
    scope: 'browser',
    authorization: `Bearer ${BROWSER_TOKEN}`,
    origin: EXTENSION_A,
  }), true);
  assert.equal(policy.authorize({
    scope: 'browser',
    authorization: `Bearer ${BROWSER_TOKEN}`,
    origin: EXTENSION_B,
  }), false);
  assert.equal(policy.authorize({
    scope: 'browser',
    authorization: `Bearer ${BROWSER_TOKEN}`,
    origin: 'https://malicious.example',
  }), false);
});

test('explicit insecure development mode does not silently authorize privileged routes', () => {
  const policy = createBridgeSecurityPolicy({
    controlToken: '',
    browserToken: '',
    allowInsecureDev: true,
  });

  assert.equal(policy.authorize({ scope: 'public' }), true);
  assert.equal(policy.authorize({ scope: 'control' }), true);
  assert.equal(policy.authorize({ scope: 'browser', origin: EXTENSION_A }), true);
  assert.equal(policy.authorize({ scope: 'browser', origin: 'https://malicious.example' }), false);
});
