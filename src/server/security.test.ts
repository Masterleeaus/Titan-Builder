import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeBridgeRequest,
  isAllowedBridgeOrigin,
} from './security.ts';

test('allows extension and origin-less local requests but rejects normal webpages', () => {
  assert.equal(isAllowedBridgeOrigin(undefined), true);
  assert.equal(isAllowedBridgeOrigin('chrome-extension://abcdefghijklmnop'), true);
  assert.equal(isAllowedBridgeOrigin('moz-extension://1234-abcd'), true);
  assert.equal(isAllowedBridgeOrigin('https://chatgpt.com'), false);
  assert.equal(isAllowedBridgeOrigin('https://malicious.example'), false);
});

test('requires the configured bridge token for browser and CLI requests', () => {
  assert.equal(
    authorizeBridgeRequest({ configuredToken: 'secret', authorization: 'Bearer secret' }),
    true,
  );
  assert.equal(
    authorizeBridgeRequest({ configuredToken: 'secret', authorization: undefined }),
    false,
  );
  assert.equal(
    authorizeBridgeRequest({ configuredToken: undefined, authorization: undefined }),
    true,
  );
});
