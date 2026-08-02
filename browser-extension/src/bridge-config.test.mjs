import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBridgeUrl,
  hostMatchesPreferredProvider,
  isStrongBridgeToken,
  normalizeBridgeConfig,
  withBridgeAuth,
} from './bridge-config.js';

test('normalizes bridge settings and rejects invalid ports', () => {
  const config = normalizeBridgeConfig({
    bridgePort: 80,
    bridgeToken: '  secret  ',
    preferredProvider: 'CHATGPT',
    superpowerCompatibility: false,
  });

  assert.equal(config.bridgePort, 5000);
  assert.equal(config.bridgeToken, 'secret');
  assert.equal(config.preferredProvider, 'chatgpt');
  assert.equal(config.superpowerCompatibility, false);
  assert.equal(getBridgeUrl(config), 'http://127.0.0.1:5000');
});

test('adds bearer authentication only for a strong configured browser token', () => {
  assert.deepEqual(withBridgeAuth({ bridgeToken: '' }, { Accept: 'text/plain' }), {
    Accept: 'text/plain',
  });
  assert.deepEqual(withBridgeAuth({ bridgeToken: 'secret' }, {}), {});
  assert.equal(isStrongBridgeToken('secret'), false);

  const token = 'browser-'.padEnd(56, 'b');
  assert.deepEqual(withBridgeAuth({ bridgeToken: token }, {}), {
    Authorization: `Bearer ${token}`,
  });
  assert.equal(isStrongBridgeToken(token), true);
});

test('routes only to the preferred provider when one is selected', () => {
  assert.equal(hostMatchesPreferredProvider('chatgpt.com', 'chatgpt'), true);
  assert.equal(hostMatchesPreferredProvider('claude.ai', 'chatgpt'), false);
  assert.equal(hostMatchesPreferredProvider('claude.ai', 'auto'), true);
});

test('normalizes capped auto-continue and workspace settings', () => {
  const config = normalizeBridgeConfig({
    autoContinueEnabled: true,
    autoContinueMax: 99,
    autoContinueFallback: true,
    activeProfileId: ' agent-1 ',
    activeSkillIds: ['testing', 'testing', 'security'],
  });

  assert.equal(config.autoContinueEnabled, true);
  assert.equal(config.autoContinueMax, 10);
  assert.equal(config.autoContinueFallback, true);
  assert.equal(config.activeProfileId, 'agent-1');
  assert.deepEqual(config.activeSkillIds, ['testing', 'security']);
});
