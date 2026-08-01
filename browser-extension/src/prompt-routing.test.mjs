import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProviderKeyForUrl,
  selectPromptTarget,
} from './prompt-routing.js';

test('getProviderKeyForUrl identifies supported AI hosts and rejects unrelated pages', () => {
  assert.equal(getProviderKeyForUrl('https://chatgpt.com/c/abc'), 'chatgpt');
  assert.equal(getProviderKeyForUrl('https://claude.ai/new'), 'claude');
  assert.equal(getProviderKeyForUrl('https://example.com'), null);
  assert.equal(getProviderKeyForUrl('not-a-url'), null);
});

test('selectPromptTarget honors explicitly requested provider', () => {
  const tabs = [
    { id: 1, url: 'https://chatgpt.com/', active: true },
    { id: 2, url: 'https://claude.ai/new', active: false },
  ];
  assert.equal(selectPromptTarget(tabs, { requestedProvider: 'claude', preferredProvider: 'chatgpt' }).id, 2);
});

test('selectPromptTarget falls back to configured provider then active supported tab', () => {
  const tabs = [
    { id: 1, url: 'https://chatgpt.com/', active: true, lastAccessed: 20 },
    { id: 2, url: 'https://deepseek.com/', active: false, lastAccessed: 30 },
    { id: 3, url: 'https://claude.ai/new', active: false, lastAccessed: 40 },
  ];

  assert.equal(selectPromptTarget(tabs, { preferredProvider: 'claude' }).id, 3);
  assert.equal(selectPromptTarget(tabs, { preferredProvider: 'gemini' }).id, 1);
});


test('selectPromptTarget does not silently route an explicit provider request elsewhere', () => {
  const tabs = [{ id: 1, url: 'https://chatgpt.com/', active: true }];
  assert.equal(selectPromptTarget(tabs, { requestedProvider: 'claude', preferredProvider: 'chatgpt' }), null);
});

test('selectPromptTarget returns null when no supported tab is available', () => {
  assert.equal(selectPromptTarget([{ id: 1, url: 'https://example.com' }], {}), null);
});
