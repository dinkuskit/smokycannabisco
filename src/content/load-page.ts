import { getEmDashEntry } from 'emdash';
import { applyPageResponse, type PageCacheHint, type PageContentSource, type PageResponseContext } from '../page-cache.ts';
import { seedPage, type PageData } from './seed-fallback';

export type ContentSource = PageContentSource;

export interface LoadedPage {
  page: PageData | null;
  source: ContentSource;
  cacheHint?: PageCacheHint;
}

function asPage(data: Partial<PageData>): PageData | null {
  if (typeof data.title !== 'string' || !Array.isArray(data.layout)) return null;
  return {
    title: data.title,
    description: typeof data.description === 'string' ? data.description : '',
    brand_name: typeof data.brand_name === 'string' ? data.brand_name : '',
    nav_label: typeof data.nav_label === 'string' ? data.nav_label : '',
    nav_href: typeof data.nav_href === 'string' ? data.nav_href : '',
    footer_text: typeof data.footer_text === 'string' ? data.footer_text : '',
    og_image_alt: typeof data.og_image_alt === 'string' ? data.og_image_alt : '',
    layout: data.layout,
  };
}

/**
 * Content source contract (see AGENTS.md):
 *
 * - **Live CMS** = last safe migration currently serving production.
 * - **Seed** = next candidate iteration to apply via `cms:sync`.
 *
 * Prefer the CMS entry whenever one exists. Never replace a good CMS entry
 * with a newer seed (that would publish an unproven iteration if sync failed
 * or was never run). Seed is only the cold-start path when no CMS entry
 * exists yet (first boot before a successful sync).
 */
export async function loadPage(slug: string): Promise<LoadedPage> {
  let page: PageData | null = null;
  let source: ContentSource = 'none';
  let cacheHint: PageCacheHint | undefined;
  let cmsReached = false;
  try {
    const { entry, error, cacheHint: hint } = await getEmDashEntry('pages', slug);
    cmsReached = true;
    cacheHint = hint;
    // A readable CMS entry is always the last safe public content.
    if (!error && entry?.data) {
      const fromCms = asPage(entry.data as Partial<PageData>);
      if (fromCms) {
        return { page: fromCms, source: 'cms', cacheHint };
      }
    }
  } catch {
    // CMS unreachable. Do not invent a "sync failed → show seed" path: if an
    // entry existed we could not read it, so fall through only when we never
    // got a successful CMS read (treated like cold start / empty DB).
    cmsReached = false;
  }

  // Cold start: no usable CMS entry. Seed is the candidate that also boots
  // the public site until the first successful sync lands that content in CMS.
  if (!page) {
    page = seedPage(slug);
    if (page) source = 'seed';
  }

  // Keep the unused flag intentional for readers of the contract: a future
  // hardening pass may refuse seed when cmsReached && entry missing after
  // production has already been synced. Today EmDash empty D1 and "no entry"
  // look the same, so seed remains the cold-start boot path.
  void cmsReached;

  return { page, source, cacheHint };
}

/**
 * Load a page and settle the response-level decisions (status, edge-cache
 * options, Vary) in the page frontmatter, which runs before Astro creates the
 * streamed Response; see `applyPageResponse` in src/page-cache.ts.
 */
export async function preparePage(astro: PageResponseContext, slug: string): Promise<LoadedPage> {
  const loaded = await loadPage(slug);
  applyPageResponse(astro, { found: loaded.page !== null, source: loaded.source, cacheHint: loaded.cacheHint, buildTime: buildTime() });
  return loaded;
}

/** The build's timestamp, defined in astro.config.mjs; undefined when it is not a date. */
function buildTime(): Date | undefined {
  const raw = import.meta.env.SMOKY_BUILD_TIME;
  if (typeof raw !== 'string') return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
