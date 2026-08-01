import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadProviderRuntime() {
  const source = await readFile(new URL('./providers.js', import.meta.url), 'utf8');
  const sandbox = { URL };
  vm.runInNewContext(
    `${source}\n;globalThis.__providerTestApi = { OPENBROWSER_PROVIDERS, getProviderForUrl, providerRootIsPresent };`,
    sandbox,
  );
  return sandbox.__providerTestApi;
}

function fakeDocument(matchingSelectors = []) {
  const matches = new Set(matchingSelectors);
  return {
    querySelector(selector) {
      return matches.has(selector) ? { selector } : null;
    },
  };
}

test('provider runtime rejects X URLs and only accepts supported grok.com chat paths', async () => {
  const { getProviderForUrl } = await loadProviderRuntime();

  for (const url of [
    'https://x.com/home',
    'https://x.com/compose/post',
    'https://x.com/messages',
    'https://x.com/user/status/1',
  ]) {
    assert.equal(getProviderForUrl(url), null);
  }

  assert.equal(getProviderForUrl('https://grok.com/')?.name, 'Grok');
  assert.equal(getProviderForUrl('https://grok.com/c/abc')?.name, 'Grok');
  assert.equal(getProviderForUrl('https://grok.com/chat/abc')?.name, 'Grok');
  assert.equal(getProviderForUrl('https://grok.com/imagine'), null);
});

test('Grok requires a provider-specific root marker before prompt insertion or submit', async () => {
  const { OPENBROWSER_PROVIDERS, providerRootIsPresent } = await loadProviderRuntime();
  const grok = OPENBROWSER_PROVIDERS.grok;

  assert.equal(providerRootIsPresent(grok, fakeDocument()), false);
  assert.equal(
    providerRootIsPresent(grok, fakeDocument(['main textarea[aria-label*="Ask Grok" i]'])),
    true,
  );

  const genericComposer = fakeDocument(['textarea', 'button[type="submit"]']);
  assert.equal(providerRootIsPresent(grok, genericComposer), false);
});
