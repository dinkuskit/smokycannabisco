import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalPathname, deniedResponse, evaluateGate, isEmdashNamespace } from '../src/namespace-gate.ts';

const configured = {
  EMDASH_ACCESS_TEAM_DOMAIN: 'example-team.cloudflareaccess.invalid',
  CF_ACCESS_AUDIENCE: 'audience-tag',
};
const request = (path, init) => new Request(`https://www.smokycannabisco.com${path}`, init);
const identity = (email) => async () => (email ? { email } : null);
const neverCalled = async () => {
  throw new Error('authenticate must not run');
};

test('canonical pathname decodes repeatedly and collapses slashes', () => {
  assert.equal(canonicalPathname('/%5Femdash//admin'), '/_emdash/admin');
  assert.equal(canonicalPathname('/%255Femdash/admin'), '/_emdash/admin');
});

test('namespace detection covers encoded, cased and doubled forms', () => {
  for (const path of ['/_emdash', '/_emdash/', '/_emdash/admin', '/_EMDASH/setup', '/%5Femdash/api/setup']) {
    assert.equal(isEmdashNamespace(path), true, path);
  }
  for (const path of ['/', '/emdash/admin', '/x/_emdash']) {
    assert.equal(isEmdashNamespace(path), false, path);
  }
});

test('public routes pass without authentication', async () => {
  const decision = await evaluateGate({ pathname: '/', request: request('/'), env: {}, authenticate: neverCalled });
  assert.deepEqual(decision, { allow: true, reason: 'public' });
});

test('development passes the namespace through', async () => {
  const decision = await evaluateGate({ pathname: '/_emdash/admin', request: request('/_emdash/admin'), env: {}, authenticate: neverCalled, dev: true });
  assert.deepEqual(decision, { allow: true, reason: 'dev' });
});

test('namespace is denied when Access is not configured', async () => {
  const decision = await evaluateGate({ pathname: '/_emdash/admin', request: request('/_emdash/admin'), env: {}, authenticate: neverCalled });
  assert.deepEqual(decision, { allow: false, reason: 'access-not-configured' });
});

test('namespace requires a valid Access identity when configured', async () => {
  const denied = await evaluateGate({ pathname: '/_emdash/admin', request: request('/_emdash/admin'), env: configured, authenticate: identity(null) });
  assert.deepEqual(denied, { allow: false, reason: 'no-identity' });
  const allowed = await evaluateGate({ pathname: '/_emdash/admin', request: request('/_emdash/admin'), env: configured, authenticate: identity('owner@example.com') });
  assert.deepEqual(allowed, { allow: true, reason: 'operator' });
});

test('allowlist rejects non-operators', async () => {
  const env = { ...configured, EMDASH_OPERATOR_ALLOWLIST: 'owner@example.com' };
  const denied = await evaluateGate({ pathname: '/_emdash/admin', request: request('/_emdash/admin'), env, authenticate: identity('other@example.com') });
  assert.deepEqual(denied, { allow: false, reason: 'not-on-allowlist' });
});

test('denied response is a no-store 404', async () => {
  const response = deniedResponse();
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'Not Found');
});
