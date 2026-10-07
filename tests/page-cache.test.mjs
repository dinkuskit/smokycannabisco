import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC_PAGE_MAX_AGE, PUBLIC_PAGE_SWR, PUBLIC_PAGE_VARY, applyPageResponse, publicPageCacheOptions } from '../src/page-cache.ts';

test('public page cache options include collection tag and TTL', () => {
  const options = publicPageCacheOptions({ tags: ['entry:home'] }, new Date('2026-10-07T00:00:00.000Z'));
  assert.equal(options.maxAge, PUBLIC_PAGE_MAX_AGE);
  assert.equal(options.swr, PUBLIC_PAGE_SWR);
  assert.ok(options.tags.includes('pages'));
  assert.ok(options.tags.includes('entry:home'));
  assert.equal(options.lastModified?.toISOString(), '2026-10-07T00:00:00.000Z');
});

test('applyPageResponse 404s missing pages and caches found pages', () => {
  const missing = { cache: { set() { throw new Error('should not cache'); } }, response: { headers: new Headers() } };
  applyPageResponse(missing, { found: false, source: 'none' });
  assert.equal(missing.response.status, 404);

  let cached;
  const found = {
    cache: { set(options) { cached = options; } },
    response: { headers: new Headers() },
  };
  applyPageResponse(found, { found: true, source: 'seed', buildTime: new Date('2026-10-07T12:00:00.000Z') });
  assert.equal(cached.maxAge, PUBLIC_PAGE_MAX_AGE);
  assert.equal(found.response.headers.get('Vary'), PUBLIC_PAGE_VARY);
});
