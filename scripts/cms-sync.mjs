#!/usr/bin/env node
/**
 * Apply or check seed/seed.json against the live EmDash CMS.
 *
 *   node scripts/cms-sync.mjs            # --check: report every difference, exit 1 on drift
 *   node scripts/cms-sync.mjs --apply    # write the seed's block types and pages, publish, re-check
 *
 * Contract: the seed is the *next* iteration (candidate). The live CMS is the
 * *last safe* iteration serving production. Sync is how the candidate becomes
 * the new safe CMS after a successful apply; until then public pages prefer
 * CMS (see AGENTS.md / src/content/load-page.ts). A failed sync must leave
 * the last safe CMS in place — seed does not automatically override it.
 *
 * Compared: each block type's label, category, description, icon and
 * active-version fields, and each page's slug, status and live data
 * (title, description, layout blocks by key). Block `_version` numbers are
 * not compared: the seed describes a fresh install (version 1) while the
 * CMS's versions follow its own history, because EmDash treats a removed
 * select option as a breaking change that needs a new, activated version.
 *
 * Identity, in this order (values are never printed):
 *   EMDASH_TOKEN                   an EmDash API token (Bearer)
 *   localhost / 127.0.0.1          EmDash's development bypass
 *   EMDASH_HEADERS or --header     custom headers, e.g. a Cloudflare Access
 *                                  service token (CF-Access-Client-Id/Secret)
 *   otherwise                      the Access JWT cloudflared cached for
 *                                  <origin>/_emdash after
 *                                  `cloudflared access login <origin>/_emdash`
 *
 * Options: --url <base> (default EMDASH_URL or https://www.smokycannabisco.com),
 * --seed <path> (default seed/seed.json), --header "Name: Value" (repeatable),
 * --override-lock (write even when an editor holds the entry's edit lock),
 * --json (machine-readable report), --help.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { EmDashApiError, EmDashClient } from 'emdash/client';
import { customHeadersInterceptor, parseHeadersFromEnv, parseHeaderStrings } from 'emdash/client/cf-access';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);

const { values: args } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    url: { type: 'string' },
    seed: { type: 'string', default: 'seed/seed.json' },
    header: { type: 'string', multiple: true, default: [] },
    'override-lock': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}
if (args.check && args.apply) fail(2, 'choose --check or --apply, not both');
const mode = args.apply ? 'apply' : 'check';
const base = (args.url ?? process.env.EMDASH_URL ?? 'https://www.smokycannabisco.com').replace(/\/+$/, '');
const origin = new URL(base).origin;
const appUrl = `${origin}/_emdash`;
const seedPath = resolve(root, args.seed);
const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
const COLLECTION = 'pages';

function fail(code, message) {
  console.error(`cms-sync: ${message}`);
  process.exit(code);
}

// ---------------------------------------------------------------- identity

function hasHeader(headers, name) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

async function cloudflaredToken(app) {
  try {
    const { stdout } = await execFileAsync('cloudflared', ['access', 'token', '-app', app]);
    const token = stdout.trim();
    return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

async function resolveIdentity() {
  const headers = { ...parseHeadersFromEnv(), ...parseHeaderStrings(args.header) };
  const token = process.env.EMDASH_TOKEN?.trim();
  if (token) return { token, headers, label: 'EmDash API token (EMDASH_TOKEN)' };
  if (/^(localhost|127\.0\.0\.1)$/.test(new URL(base).hostname)) return { devBypass: true, headers, label: `EmDash development bypass on ${origin}` };
  if (hasHeader(headers, 'cf-access-client-id') || hasHeader(headers, 'cf-access-token')) return { headers, label: 'custom headers (EMDASH_HEADERS / --header)' };
  const jwt = await cloudflaredToken(appUrl);
  if (!jwt) fail(2, `no identity for ${origin}. Sign in once with your own Access login:\n  cloudflared access login ${appUrl}\nthen run this again (the login is cached for the Access session length).`);
  return { headers: { ...headers, 'cf-access-token': jwt }, label: `cloudflared's cached Access login for ${appUrl}` };
}

// ------------------------------------------------------------- comparison

function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key] = canon(value[key]);
  return out;
}

function canonicalFields(fields) {
  return (fields ?? []).map((field) => canon({
    slug: field.slug,
    label: field.label,
    type: field.type,
    required: field.required ?? false,
    defaultValue: field.defaultValue,
    validation: field.validation,
    options: field.options,
  }));
}

/** The CMS's active version, or the one `currentVersion` names. */
function activeVersion(blockType) {
  return blockType.versions?.find((version) => version.active) ?? blockType.versions?.find((version) => version.version === blockType.currentVersion) ?? null;
}

function seedVersion(blockType) {
  return blockType.versions.find((version) => version.version === blockType.currentVersion);
}

function canonicalPage(data) {
  return canon({
    title: data?.title,
    description: data?.description,
    brand_name: data?.brand_name,
    nav_label: data?.nav_label,
    nav_href: data?.nav_href,
    footer_text: data?.footer_text,
    og_image_alt: data?.og_image_alt,
    layout: (Array.isArray(data?.layout) ? data.layout : []).map(({ _version, ...block }) => block),
  });
}

/** Paths where two canonical values differ, at most `limit`. */
function diffPaths(left, right, path = '', out = [], limit = 12) {
  if (out.length >= limit) return out;
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) diffPaths(left[index], right[index], `${path}[${index}]`, out, limit);
    return out;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) diffPaths(left[key], right[key], path ? `${path}.${key}` : key, out, limit);
    return out;
  }
  if (JSON.stringify(left) !== JSON.stringify(right)) out.push(path || '(value)');
  return out;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const meta = (value) => (typeof value === 'string' && value.trim() ? value : null);

function blockTypeReport(seedType, cmsType) {
  if (!cmsType) return { slug: seedType.slug, state: 'missing', differences: ['missing in the CMS'] };
  const active = activeVersion(cmsType);
  const differences = [];
  for (const key of ['label', 'category', 'description', 'icon']) {
    if (meta(seedType[key]) !== meta(cmsType[key])) differences.push(`${key}: seed ${JSON.stringify(meta(seedType[key]))}, CMS ${JSON.stringify(meta(cmsType[key]))}`);
  }
  const fieldsDiffer = !active || !same(canonicalFields(seedVersion(seedType).fields), canonicalFields(active.fields));
  if (fieldsDiffer) differences.push(`fields of the active version ${active?.version ?? '?'} differ: ${diffPaths(canonicalFields(active?.fields), canonicalFields(seedVersion(seedType).fields)).join(', ')}`);
  return { slug: seedType.slug, state: differences.length ? 'differs' : 'equal', differences, fieldsDiffer, activeVersion: active?.version ?? null, fingerprint: active?.fingerprint ?? null };
}

function pageReport(seedPage, entry) {
  const wanted = seedPage.status ?? 'published';
  if (!entry) return { slug: seedPage.slug, state: 'missing', differences: ['missing in the CMS'] };
  const live = entry.liveData ?? entry.data;
  const draft = entry.draftRevisionId ? entry.data : null;
  const differences = [];
  if (entry.status !== wanted) differences.push(`status: seed ${wanted}, CMS ${entry.status}`);
  if (entry.slug !== seedPage.slug) differences.push(`slug: seed ${seedPage.slug}, CMS ${entry.slug}`);
  const livePaths = diffPaths(canonicalPage(live), canonicalPage(seedPage.data));
  if (livePaths.length) differences.push(`live data differs: ${livePaths.join(', ')}`);
  let pendingDraft = false;
  if (draft) {
    const draftPaths = diffPaths(canonicalPage(draft), canonicalPage(seedPage.data));
    if (draftPaths.length) {
      pendingDraft = true;
      differences.push(`a pending draft differs from the seed: ${draftPaths.join(', ')} (--apply replaces it; the revision history keeps it)`);
    }
  }
  return { slug: seedPage.slug, id: entry.id, state: differences.length ? 'differs' : 'equal', differences, pendingDraft, liveDiffers: livePaths.length > 0, status: entry.status };
}

// ------------------------------------------------------------------- API

async function getOrNull(client, path) {
  try {
    return await client.request('GET', path);
  } catch (error) {
    if (error instanceof EmDashApiError && error.status === 404) return null;
    throw error;
  }
}

async function readState(client) {
  const listed = await client.request('GET', '/schema/block-types');
  const cmsTypes = new Map();
  for (const seedType of seed.blockTypes ?? []) {
    const found = await getOrNull(client, `/schema/block-types/${encodeURIComponent(seedType.slug)}`);
    cmsTypes.set(seedType.slug, found?.item ?? null);
  }
  const seedTypeSlugs = new Set((seed.blockTypes ?? []).map((type) => type.slug));
  const extraTypes = (listed.items ?? []).map((type) => type.slug).filter((slug) => !seedTypeSlugs.has(slug));

  const entries = new Map();
  for (const page of seed.content?.[COLLECTION] ?? []) {
    const found = await getOrNull(client, `/content/${COLLECTION}/${encodeURIComponent(page.slug)}`);
    entries.set(page.slug, found ? { ...found.item, _rev: found._rev } : null);
  }
  const seedSlugs = new Set((seed.content?.[COLLECTION] ?? []).map((page) => page.slug));
  const extraPages = [];
  let cursor;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await client.request('GET', `/content/${COLLECTION}?${query}`);
    for (const item of page.items ?? []) if (!seedSlugs.has(item.slug)) extraPages.push(`${item.slug ?? item.id} (${item.status})`);
    cursor = page.nextCursor;
  } while (cursor);

  return { cmsTypes, extraTypes, entries, extraPages };
}

function compare(state) {
  const blockTypes = (seed.blockTypes ?? []).map((type) => blockTypeReport(type, state.cmsTypes.get(type.slug)));
  const pages = (seed.content?.[COLLECTION] ?? []).map((page) => pageReport(page, state.entries.get(page.slug)));
  const extras = [...state.extraTypes.map((slug) => `block type ${slug}`), ...state.extraPages.map((label) => `page ${label}`)];
  const equal = blockTypes.every((type) => type.state === 'equal') && pages.every((page) => page.state === 'equal') && extras.length === 0;
  return { blockTypes, pages, extras, equal };
}

async function applyBlockTypes(client, report, state, log) {
  for (const type of report.blockTypes) {
    if (type.state === 'equal') continue;
    const seedType = seed.blockTypes.find((candidate) => candidate.slug === type.slug);
    const fields = seedVersion(seedType).fields;
    if (type.state === 'missing') {
      await client.request('POST', '/schema/block-types', {
        slug: seedType.slug,
        label: seedType.label,
        ...(meta(seedType.category) ? { category: seedType.category } : {}),
        ...(meta(seedType.description) ? { description: seedType.description } : {}),
        ...(meta(seedType.icon) ? { icon: seedType.icon } : {}),
        fields,
      });
      log(`block type ${type.slug}: created`);
      continue;
    }
    const cmsType = state.cmsTypes.get(type.slug);
    const body = { expectedFingerprint: type.fingerprint };
    for (const key of ['label', 'category', 'description', 'icon']) if (meta(seedType[key]) !== meta(cmsType[key])) body[key] = meta(seedType[key]);
    if (type.fieldsDiffer) body.fields = fields;
    let updated;
    try {
      updated = (await client.request('PUT', `/schema/block-types/${encodeURIComponent(type.slug)}`, body)).item;
      log(`block type ${type.slug}: updated in place (compatible change)`);
    } catch (error) {
      if (!(error instanceof EmDashApiError && error.code === 'BLOCK_TYPE_BREAKING_CHANGE')) throw error;
      // A breaking change needs its own version. EmDash creates one, or
      // reuses an inactive version that already holds exactly these fields,
      // and leaves it inactive until it is activated against the still-active
      // version's fingerprint.
      const knownVersions = new Set(cmsType.versions.map((version) => version.version));
      updated = (await client.request('PUT', `/schema/block-types/${encodeURIComponent(type.slug)}`, { ...body, breaking: true })).item;
      const target = updated.versions.find((version) => !version.active && same(canonicalFields(version.fields), canonicalFields(fields)));
      if (!target) throw new Error(`block type ${type.slug}: the breaking update left no version with the seed's fields`);
      const stillActive = activeVersion(updated);
      updated = (await client.request('POST', `/schema/block-types/${encodeURIComponent(type.slug)}/versions/${target.version}/activate`, { expectedFingerprint: stillActive.fingerprint })).item;
      log(`block type ${type.slug}: breaking change, version ${target.version} ${knownVersions.has(target.version) ? 'reactivated (it already held these fields)' : 'created and activated'} (was ${stillActive.version})`);
    }
    state.cmsTypes.set(type.slug, updated);
  }
}

async function applyPages(client, report, state, log) {
  const versions = new Map();
  for (const [slug, type] of state.cmsTypes) if (type) versions.set(slug, type.currentVersion);
  for (const page of report.pages) {
    if (page.state === 'equal') continue;
    const seedPage = seed.content[COLLECTION].find((candidate) => candidate.slug === page.slug);
    const data = {
      ...seedPage.data,
      layout: seedPage.data.layout.map((block) => ({ ...block, _version: versions.get(block._type) ?? block._version })),
    };
    let rev;
    let id;
    if (page.state === 'missing') {
      const created = await client.request('POST', `/content/${COLLECTION}`, { slug: seedPage.slug, data, status: 'draft' });
      id = created.item.id;
      rev = created._rev;
      log(`page ${page.slug}: created as a draft`);
    } else {
      const entry = state.entries.get(page.slug);
      id = entry.id;
      const written = await client.request('PUT', `/content/${COLLECTION}/${encodeURIComponent(id)}`, {
        data,
        slug: seedPage.slug,
        _rev: entry._rev,
        migrateBlocks: true,
        ...(args['override-lock'] ? { overrideLock: true } : {}),
      });
      rev = written._rev;
      log(`page ${page.slug}: draft written from the seed${page.pendingDraft ? ' (replaced a pending draft)' : ''}`);
    }
    if ((seedPage.status ?? 'published') === 'published') {
      await client.request('POST', `/content/${COLLECTION}/${encodeURIComponent(id)}/publish`, { _rev: rev, ...(args['override-lock'] ? { overrideLock: true } : {}) });
      log(`page ${page.slug}: published`);
    }
  }
}

// ------------------------------------------------------------------ main

function print(report, label) {
  console.log(label);
  for (const type of report.blockTypes) console.log(`  block type ${type.slug}: ${type.state}${type.differences.length ? `: ${type.differences.join('; ')}` : ''}`);
  for (const page of report.pages) console.log(`  page ${page.slug}: ${page.state}${page.differences.length ? `: ${page.differences.join('; ')}` : ''}`);
  console.log(`  extra in the CMS: ${report.extras.length ? report.extras.join(', ') : 'none'}`);
}

const identity = await resolveIdentity();
const client = new EmDashClient({
  baseUrl: base,
  ...(identity.token ? { token: identity.token } : {}),
  ...(identity.devBypass ? { devBypass: true } : {}),
  interceptors: [customHeadersInterceptor(identity.headers)],
});
const seedSummary = `${seed.blockTypes?.length ?? 0} block types, ${(seed.content?.[COLLECTION] ?? []).length} pages`;
const applied = [];
const log = (line) => {
  applied.push(line);
  if (!args.json) console.log(`  ${line}`);
};

let before;
let after;
try {
  if (!args.json) console.log(`cms-sync (${mode}): ${args.seed} (${seedSummary}) against ${base}\n  identity: ${identity.label}`);
  const state = await readState(client);
  before = compare(state);
  if (!args.json) print(before, 'Before:');
  if (mode === 'apply' && !before.equal) {
    if (!args.json) console.log('Applying:');
    await applyBlockTypes(client, before, state, log);
    await applyPages(client, before, state, log);
    after = compare(await readState(client));
    if (!args.json) print(after, 'After:');
  }
} catch (error) {
  if (error instanceof EmDashApiError) fail(1, `${error.status} ${error.code}: ${error.message}${error.details ? ` ${JSON.stringify(error.details)}` : ''}`);
  fail(1, error instanceof Error ? error.message : String(error));
}

const final = after ?? before;
if (args.json) {
  console.log(JSON.stringify({ at: new Date().toISOString(), mode, url: base, identity: identity.label, seed: args.seed, before, applied, after: after ?? null, equal: final.equal }, null, 2));
} else if (final.equal) {
  console.log(mode === 'apply' && after ? 'Result: the CMS now equals the seed.' : 'Result: the CMS equals the seed.');
} else {
  console.log(mode === 'apply' ? 'Result: DRIFT remains after applying; see the differences above.' : 'Result: DRIFT. Run with --apply to write the seed into the CMS (after the Worker that renders it is deployed).');
}
process.exit(final.equal ? 0 : 1);
