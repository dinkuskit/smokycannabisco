import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalWorker } from './lib/workerd.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(existsSync(join(root, 'dist/server/wrangler.json')), 'run npm run build first: dist/server/wrangler.json is missing');

const checks = [];
let worker;

const request = (base, path, init = {}) =>
  fetch(base + path, { signal: AbortSignal.timeout(20000), redirect: 'manual', ...init });

function hostRequest(port, path, host, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers: { host, ...extraHeaders } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const EDGE_POLICY = 'public, max-age=300, stale-while-revalidate=60';
function expectCachedPage(label, response, pathTag) {
  const cdn = response.headers.get('cloudflare-cdn-cache-control');
  record(`${label} asks the edge to cache for five minutes with a one-minute stale window`, cdn === EDGE_POLICY, `cloudflare-cdn-cache-control ${cdn}`);
  const tags = (response.headers.get('cache-tag') ?? '').split(',').map((tag) => tag.trim());
  record(`${label} is tagged with the pages collection, its path and the Worker version`, tags.includes('pages') && tags.includes(pathTag) && tags.some((tag) => /^astro-version:.+/.test(tag)), `cache-tag ${response.headers.get('cache-tag')}`);
  const vary = response.headers.get('vary') ?? '';
  record(`${label} varies by host and cookie`, /\bhost\b/i.test(vary) && /\bcookie\b/i.test(vary), `vary ${vary}`);
}
function expectUncached(label, cdn) {
  record(`${label} is not edge-cached`, cdn === 'no-store', `cloudflare-cdn-cache-control ${cdn}`);
}

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) throw new Error(`${name}: ${detail}`);
}

async function expectDenied(base, path, init = {}) {
  const response = await request(base, path, init);
  const body = await response.text();
  const label = `${init.method ?? 'GET'} ${path}`;
  record(`${label} is 404`, response.status === 404, `status ${response.status}`);
  record(`${label} has no redirect`, response.headers.get('location') === null, `location ${response.headers.get('location')}`);
  record(`${label} serves no admin or setup HTML`, !/_emdash\/admin|passkey|setup|<script/i.test(body) && body.length < 2000, `body ${body.slice(0, 120)}`);
  expectUncached(label, response.headers.get('cloudflare-cdn-cache-control'));
}

try {
  try {
    worker = await startLocalWorker({ root });
  } catch (error) {
    record('local workerd started', false, error instanceof Error ? error.message : String(error));
  }
  record('local workerd started', true);
  const { base, port } = worker;

  const home = await request(base, '/');
  const homeBody = await home.text();
  record('GET / is 200', home.status === 200, `status ${home.status}`);
  record('GET / is HTML', /text\/html/.test(home.headers.get('content-type') ?? ''), home.headers.get('content-type'));
  record('GET / renders from the seed on a fresh database (cold start)', /data-content-source="seed"/.test(homeBody), homeBody.slice(0, 400));
  record('GET / carries crawler-visible H1', /<h1[^>]*>Smoky Cannabis Company — Hemp-Derived THCa Flower &amp; Products<\/h1>|<h1[^>]*>Smoky Cannabis Company — Hemp-Derived THCa Flower & Products<\/h1>/.test(homeBody), '');
  record('GET / states we are not GSCC / Cherokee dispensary', /separate business from Great Smoky Cannabis Company/i.test(homeBody) && /not the Cherokee NC dispensary|not the Cherokee dispensary/i.test(homeBody) && /Smoky Mountain CBD/i.test(homeBody), '');
  record('GET / answers AEO FAQ questions in HTML', /Does THCa get you high/i.test(homeBody) && /Is THCa legal in North Carolina/i.test(homeBody), '');
  record('GET / links live store categories with UTMs', homeBody.includes('product-category/edibles/') && homeBody.includes('product-category/thca-flower/') && homeBody.includes('product-category/cannabis-concentrates/') && homeBody.includes('utm_source=smokycannabisco') && homeBody.includes('utm_campaign=gscc_intercept'), '');
  record('GET / does not link the dead concentrates path', !homeBody.includes('/product-category/concentrates/'), '');
  record('GET / canonical is www', /<link rel="canonical" href="https:\/\/www\.smokycannabisco\.com\/?"/.test(homeBody), '');
  record('GET / declares a real OG image path', /property="og:image" content="https:\/\/www\.smokycannabisco\.com\/og-image\.jpg"/.test(homeBody), '');
  record('GET / title marks Not GSCC', /Not GSCC/i.test(homeBody), '');
  expectCachedPage('GET /', home, 'astro-path:/');

  for (const path of ['/_emdash', '/_emdash/', '/_emdash/admin', '/_emdash/setup', '/_EMDASH/admin', '/%5Femdash/admin']) {
    await expectDenied(base, path);
  }

  const missing = await request(base, '/nothing-here');
  record('GET /nothing-here is 404', missing.status === 404, `status ${missing.status}`);
  expectUncached('GET /nothing-here', missing.headers.get('cloudflare-cdn-cache-control'));

  for (const [path, target] of [
    ['/', 'https://www.smokycannabisco.com/'],
    ['/?x=1', 'https://www.smokycannabisco.com/?x=1'],
    ['/_emdash/admin', 'https://www.smokycannabisco.com/_emdash/admin'],
  ]) {
    const redirected = await hostRequest(port, path, 'smokycannabisco.com');
    record(`apex ${path} is 301 to www`, redirected.status === 301 && redirected.headers.location === target, `status ${redirected.status} location ${redirected.headers.location}`);
    expectUncached(`apex ${path}`, redirected.headers['cloudflare-cdn-cache-control']);
  }
  const wwwServed = await hostRequest(port, '/', 'www.smokycannabisco.com');
  record('www host is served, not redirected', wwwServed.status === 200 && wwwServed.headers.location === undefined && /data-content-source="seed"/.test(wwwServed.body), `status ${wwwServed.status}`);

  const sitemap = await request(base, '/sitemap.xml');
  const sitemapBody = await sitemap.text();
  record('GET /sitemap.xml is XML', sitemap.status === 200 && /application\/xml/.test(sitemap.headers.get('content-type') ?? '') && sitemapBody.includes('<urlset') && sitemapBody.includes('https://www.smokycannabisco.com/'), `${sitemap.status} ${sitemap.headers.get('content-type')} ${sitemapBody.slice(0, 120)}`);
  record('GET /sitemap.xml is not an HTML shell', !/<html/i.test(sitemapBody), '');

  for (const [path, type] of [['/robots.txt', 'text/plain'], ['/favicon.svg', 'image/svg+xml'], ['/og-image.jpg', 'image/jpeg'], ['/hero-ridge.svg', 'image/svg+xml']]) {
    const asset = await request(base, path);
    record(`GET ${path} is 200 ${type}`, asset.status === 200 && (asset.headers.get('content-type') ?? '').includes(type), `${asset.status} ${asset.headers.get('content-type')}`);
  }

  const ogImage = Buffer.from(await (await request(base, '/og-image.jpg')).arrayBuffer());
  const committed = await readFile(join(root, 'public/og-image.jpg'));
  record('GET /og-image.jpg is the committed JPEG', ogImage.equals(committed) && ogImage[0] === 0xff && ogImage[1] === 0xd8, `${ogImage.length} bytes`);

  const summary = { at: new Date().toISOString(), checks };
  const outDir = join(root, 'runs/smoke-runs');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'last.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Smoke passed: ${checks.length} checks against local workerd on ${base}.`);
} catch (error) {
  console.error(error);
  if (worker) console.error(worker.logs().slice(-4000));
  process.exitCode = 1;
} finally {
  if (worker) await worker.stop();
}
