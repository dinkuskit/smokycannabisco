import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the production Wrangler config for `wrangler deploy` from the one
 * the Astro adapter emitted at build time, with production identifiers from
 * the environment so they never enter source:
 *
 *   SMOKY_D1_ID           production D1 database id (required)
 *   SMOKY_D1_NAME         production D1 database name (default smokycannabisco-site-cms)
 *   SMOKY_R2_BUCKET       production R2 bucket name (default smokycannabisco-site-media)
 *   SMOKY_CUSTOM_DOMAIN   optional custom domains, comma-separated
 *   SMOKY_WORKERS_DEV     "true" to serve on workers.dev
 *   SMOKY_SANDBOX         "false" to drop worker_loaders
 *   SMOKY_WORKER_NAME     optional Worker name override
 *   SMOKY_SITE_URL        optional public origin for runtime vars
 *
 * Output: dist/server/wrangler.production.json (ignored). Nothing here deploys.
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const built = JSON.parse(readFileSync(join(root, 'dist/server/wrangler.json'), 'utf8'));
const env = process.env;
const d1Id = env.SMOKY_D1_ID?.trim();
if (!d1Id) {
  console.error('SMOKY_D1_ID is required (the production D1 database id).');
  process.exit(2);
}
const config = {
  ...built,
  ...(env.SMOKY_WORKER_NAME?.trim() ? { name: env.SMOKY_WORKER_NAME.trim() } : {}),
  workers_dev: env.SMOKY_WORKERS_DEV === 'true',
  preview_urls: false,
  vars: {
    ...(built.vars ?? {}),
    ...(env.SMOKY_SITE_URL?.trim() ? { EMDASH_SITE_URL: env.SMOKY_SITE_URL.trim() } : {}),
  },
  d1_databases: (built.d1_databases ?? []).map((db) =>
    db.binding === 'DB' ? { ...db, database_name: env.SMOKY_D1_NAME?.trim() || 'smokycannabisco-site-cms', database_id: d1Id } : db,
  ),
  r2_buckets: (built.r2_buckets ?? []).map((bucket) =>
    bucket.binding === 'MEDIA' ? { ...bucket, bucket_name: env.SMOKY_R2_BUCKET?.trim() || 'smokycannabisco-site-media' } : bucket,
  ),
};
if (env.SMOKY_SANDBOX === 'false') delete config.worker_loaders;
const domains = (env.SMOKY_CUSTOM_DOMAIN ?? '').split(',').map((d) => d.trim()).filter(Boolean);
if (domains.length) config.routes = domains.map((pattern) => ({ pattern, custom_domain: true }));
else delete config.routes;
mkdirSync(join(root, 'dist/server'), { recursive: true });
const out = join(root, 'dist/server/wrangler.production.json');
writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
const summary = {
  name: config.name,
  workers_dev: config.workers_dev,
  routes: config.routes ?? [],
  d1: config.d1_databases.map((db) => `${db.binding}=${db.database_name}`),
  r2: config.r2_buckets.map((b) => `${b.binding}=${b.bucket_name}`),
  worker_loaders: Boolean(config.worker_loaders),
  cache: config.cache ?? null,
  version_metadata: config.version_metadata?.binding ?? null,
};
console.log(`Wrote ${out}\n${JSON.stringify(summary, null, 2)}`);
