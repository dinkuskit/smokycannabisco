import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANONICAL_ORIGIN, canonicalLocation, isRedirectedHost, normaliseHost, permanentRedirect, redirectTarget } from '../src/host-canonical.ts';

const request = (url, headers = {}) => new Request(url, { headers });

test('host normalisation lowers case and drops ports and trailing dots', () => {
  assert.equal(normaliseHost(' SmokyCannabisCo.com '), 'smokycannabisco.com');
  assert.equal(normaliseHost('smokycannabisco.com:443'), 'smokycannabisco.com');
  assert.equal(normaliseHost('smokycannabisco.com.'), 'smokycannabisco.com');
  assert.equal(normaliseHost('[::1]:8787'), '');
});

test('only the apex is redirected to www', () => {
  for (const host of ['smokycannabisco.com', 'SMOKYCANNABISCO.COM', 'smokycannabisco.com:8787', 'smokycannabisco.com.']) {
    assert.equal(isRedirectedHost(host), true, host);
  }
  for (const host of ['www.smokycannabisco.com', '127.0.0.1:8787', 'localhost', 'smokycannabisco.com.evil.example', undefined]) {
    assert.equal(isRedirectedHost(host), false, String(host));
  }
});

test('the target keeps the path and query on the constant www origin', () => {
  assert.equal(CANONICAL_ORIGIN, 'https://www.smokycannabisco.com');
  assert.equal(canonicalLocation(new URL('http://smokycannabisco.com/')), 'https://www.smokycannabisco.com/');
  assert.equal(canonicalLocation(new URL('https://smokycannabisco.com/?x=1')), 'https://www.smokycannabisco.com/?x=1');
  assert.equal(canonicalLocation(new URL('https://smokycannabisco.com/_emdash/admin')), 'https://www.smokycannabisco.com/_emdash/admin');
});

test('the redirect target follows the Host header first, then the URL', () => {
  assert.equal(redirectTarget(request('http://127.0.0.1:8787/', { host: 'smokycannabisco.com' })), 'https://www.smokycannabisco.com/');
  assert.equal(redirectTarget(request('https://smokycannabisco.com/')), 'https://www.smokycannabisco.com/');
  assert.equal(redirectTarget(request('https://www.smokycannabisco.com/')), null);
  assert.equal(redirectTarget(request('http://127.0.0.1:8787/', { host: 'www.smokycannabisco.com' })), null);
});

test('the redirect response is a bodiless 301 with only a location', async () => {
  const response = permanentRedirect('https://www.smokycannabisco.com/');
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://www.smokycannabisco.com/');
  assert.equal(await response.text(), '');
});
