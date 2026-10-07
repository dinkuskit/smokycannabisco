#!/usr/bin/env node
/**
 * Live-equals-seed check (decision cms-sync-011).
 *
 *   npm run build && node scripts/live-check.mjs [--live https://www.smokycannabisco.com] [--path / --path /testers]
 *
 * Renders each page from the seed on local workerd (the production build on
 * an empty D1, as the smoke test does) and fetches the same path from the
 * live site, then compares the two <main> elements byte for byte. The live
 * body's data-content-source (cms or seed) and the edge-cache status are
 * reported; a difference fails the check and the first mismatch is printed
 * with context. Both bodies are written under ignored runs/live-check-runs/.
 *
 * The edge keeps a page for up to five minutes after a publish or deploy
 * purge fails, so a difference on a cache HIT may be stale: the check then
 * refetches once with a cache-busting query and compares again.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startLocalWorker } from './lib/workerd.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { values: args } = parseArgs({
  options: {
    live: { type: 'string', default: process.env.LIVE_URL ?? 'https://www.smokycannabisco.com' },
    path: { type: 'string', multiple: true, default: [] },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});
const live = args.live.replace(/\/+$/, '');
const paths = args.path.length ? args.path : ['/'];
if (args.help) {
  console.log(`live-check: compare the live <main> of ${paths.join(' and ')} with a seed render of the local build.\n  --live <origin>   the site to check (default ${live})\n  --path <path>     a path to compare (repeatable; default /)`);
  process.exit(0);
}

function mainOf(html) {
  const match = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/);
  return match ? match[0] : null;
}

function sourceOf(html) {
  return html.match(/data-content-source="([^"]*)"/)?.[1] ?? null;
}

/** The first point where two strings differ, with context on both sides. */
function firstDifference(left, right, context = 160) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  const from = Math.max(0, index - context);
  return {
    offset: index,
    local: left.slice(from, index + context),
    live: right.slice(from, index + context),
  };
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { accept: 'text/html', ...init.headers } });
  return { response, body: await response.text() };
}

const runDir = join(root, 'runs/live-check-runs', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(runDir, { recursive: true });
const results = [];
let worker;
try {
  worker = await startLocalWorker({ root });
  console.log(`live-check: seed render from ${worker.base} (production build on an empty D1) against ${live}`);
  for (const path of paths) {
    const name = path === '/' ? 'index' : path.replace(/^\//, '').replace(/[^a-z0-9-]+/gi, '-');
    const local = await fetchText(`${worker.base}${path}`);
    let remote = await fetchText(`${live}${path}`);
    const localMain = mainOf(local.body);
    let remoteMain = mainOf(remote.body);
    let cacheStatus = remote.response.headers.get('cf-cache-status');
    let refetched = false;
    if (localMain !== remoteMain && cacheStatus && cacheStatus !== 'MISS') {
      refetched = true;
      remote = await fetchText(`${live}${path}${path.includes('?') ? '&' : '?'}live-check=${Date.now()}`);
      remoteMain = mainOf(remote.body);
      cacheStatus = `${cacheStatus}, then ${remote.response.headers.get('cf-cache-status') ?? 'no cache status'} on a fresh key`;
    }
    await writeFile(join(runDir, `${name}-local.html`), local.body);
    await writeFile(join(runDir, `${name}-live.html`), remote.body);
    const equal = localMain !== null && localMain === remoteMain;
    const result = {
      path,
      equal,
      live: { status: remote.response.status, source: sourceOf(remote.body), cacheStatus, age: remote.response.headers.get('age'), refetched, mainLength: remoteMain?.length ?? null },
      local: { status: local.response.status, source: sourceOf(local.body), mainLength: localMain?.length ?? null },
    };
    results.push(result);
    console.log(`  ${path}: ${equal ? 'equal' : 'DIFFERENT'}; live ${result.live.status} from ${result.live.source ?? 'no content-source attribute'} (cf-cache-status ${cacheStatus ?? 'none'}${result.live.age ? `, age ${result.live.age}s` : ''}); local ${result.local.status} from ${result.local.source ?? 'none'}`);
    if (!equal) {
      if (localMain === null || remoteMain === null) {
        console.log(`    <main> missing in ${localMain === null ? 'the local render' : 'the live page'}`);
      } else {
        const diff = firstDifference(localMain, remoteMain);
        console.log(`    first difference at offset ${diff.offset} of ${localMain.length} (local) / ${remoteMain.length} (live)`);
        console.log(`    local: …${diff.local}…`);
        console.log(`    live:  …${diff.live}…`);
      }
    }
  }
} catch (error) {
  console.error(`live-check: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
} finally {
  if (worker) await worker.stop();
}
await writeFile(join(runDir, 'summary.json'), `${JSON.stringify({ at: new Date().toISOString(), live, results }, null, 2)}\n`);
if (process.exitCode === 2) process.exit(2);
const allEqual = results.length === paths.length && results.every((result) => result.equal);
console.log(allEqual ? `Result: the live site equals the seed render on ${paths.join(' and ')}. Bodies in ${runDir}.` : `Result: the live site DIFFERS from the seed render. Bodies in ${runDir}.`);
process.exit(allEqual ? 0 : 1);
