import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRepositoryChildEnvironment,
  formatEnvironmentGrantPreview,
  redactChildOutput,
  validateEnvironmentGrants,
} from './child-environment.ts';

const sourceEnvironment: NodeJS.ProcessEnv = {
  PATH: '/usr/local/bin:/usr/bin',
  HOME: '/home/operator',
  TEMP: '/tmp',
  LANG: 'en_AU.UTF-8',
  LC_ALL: 'en_AU.UTF-8',
  CI: 'true',
  CUSTOM_BUILD_FLAG: 'enabled',
  HTTP_PROXY: 'http://proxy.example:8080',
  BRIDGE_TOKEN: 'bridge-secret-value',
  BRIDGE_BROWSER_TOKEN: 'browser-secret-value',
  OPENAI_API_KEY: 'provider-secret-value',
  GITHUB_TOKEN: 'github-secret-value',
  UNRELATED_PASSWORD: 'unrelated-secret-value',
  NODE_OPTIONS: '--require /tmp/host-hook.cjs',
};

test('repository children receive only the baseline runtime allowlist by default', () => {
  const result = buildRepositoryChildEnvironment(sourceEnvironment);

  assert.deepEqual(result.env, {
    PATH: '/usr/local/bin:/usr/bin',
    HOME: '/home/operator',
    TEMP: '/tmp',
    LANG: 'en_AU.UTF-8',
    LC_ALL: 'en_AU.UTF-8',
    CI: 'true',
  });
  assert.equal(result.env.BRIDGE_TOKEN, undefined);
  assert.equal(result.env.BRIDGE_BROWSER_TOKEN, undefined);
  assert.equal(result.env.OPENAI_API_KEY, undefined);
  assert.equal(result.env.GITHUB_TOKEN, undefined);
  assert.equal(result.env.UNRELATED_PASSWORD, undefined);
  assert.equal(result.env.NODE_OPTIONS, undefined);
  assert.equal(result.env.CUSTOM_BUILD_FLAG, undefined);
  assert.equal(result.env.HTTP_PROXY, undefined);
});

test('explicit non-sensitive grants are canonical, deterministic, and value-redacted', () => {
  const grants = validateEnvironmentGrants(['http_proxy', 'CUSTOM_BUILD_FLAG', 'HTTP_PROXY']);
  const result = buildRepositoryChildEnvironment(sourceEnvironment, grants);

  assert.deepEqual(grants, ['CUSTOM_BUILD_FLAG', 'HTTP_PROXY']);
  assert.equal(result.env.CUSTOM_BUILD_FLAG, 'enabled');
  assert.equal(result.env.HTTP_PROXY, 'http://proxy.example:8080');
  assert.equal(formatEnvironmentGrantPreview(grants), 'CUSTOM_BUILD_FLAG, HTTP_PROXY');

  const redacted = redactChildOutput(
    'flag=enabled proxy=http://proxy.example:8080',
    result.redactions,
  );
  assert.equal(redacted.includes('enabled'), false);
  assert.equal(redacted.includes('http://proxy.example:8080'), false);
  assert.equal(redacted, 'flag=[REDACTED] proxy=[REDACTED]');
});

test('secret-bearing and process-injection variables cannot be granted', () => {
  for (const name of [
    'BRIDGE_TOKEN',
    'bridge_browser_token',
    'OPENAI_API_KEY',
    'GITHUB_TOKEN',
    'UNRELATED_PASSWORD',
    'NODE_OPTIONS',
    'NODE_PATH',
    'LD_PRELOAD',
    'DYLD_INSERT_LIBRARIES',
    'BASH_ENV',
    'npm_config_//registry.npmjs.org/:_authToken',
  ]) {
    assert.throws(
      () => validateEnvironmentGrants([name]),
      new RegExp(`Environment variable .*${escapeForRegExp(name)}.* cannot be granted`, 'i'),
    );
  }
});

test('removed credential values are redacted from child output and diagnostics', () => {
  const result = buildRepositoryChildEnvironment(sourceEnvironment);
  const output = [
    'bridge=bridge-secret-value',
    'browser=browser-secret-value',
    'provider=provider-secret-value',
    'github=github-secret-value',
    'password=unrelated-secret-value',
    'path=/usr/local/bin:/usr/bin',
  ].join('\n');

  const redacted = redactChildOutput(output, result.redactions);
  assert.equal(redacted.includes('bridge-secret-value'), false);
  assert.equal(redacted.includes('browser-secret-value'), false);
  assert.equal(redacted.includes('provider-secret-value'), false);
  assert.equal(redacted.includes('github-secret-value'), false);
  assert.equal(redacted.includes('unrelated-secret-value'), false);
  assert.equal(redacted.includes('/usr/local/bin:/usr/bin'), true);
  assert.match(redacted, /bridge=\[REDACTED\]/);
});

test('environment grant validation rejects malformed names and remains bounded', () => {
  assert.throws(() => validateEnvironmentGrants(['']), /valid environment variable name/i);
  assert.throws(() => validateEnvironmentGrants(['NOT-AN-ENV-NAME']), /valid environment variable name/i);
  assert.throws(
    () => validateEnvironmentGrants(Array.from({ length: 33 }, (_, index) => `SAFE_${index}`)),
    /at most 32 environment variable grants/i,
  );
});

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
