/**
 * Pure host logic for the apex → www redirect.
 * Canonical host is www.smokycannabisco.com (matches the live site's
 * historical canonical). Apex requests permanently redirect to www.
 * No Astro imports, so the unit tests run it directly under Node.
 */
export const CANONICAL_ORIGIN = 'https://www.smokycannabisco.com';
export const REDIRECTED_HOSTS: ReadonlySet<string> = new Set(['smokycannabisco.com']);

/** Lower-case, without a port or a trailing dot; empty for anything unusable. */
export function normaliseHost(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const host = value.trim().toLowerCase();
  if (!host || host.startsWith('[')) return '';
  const bare = host.replace(/:\d*$/, '');
  return bare.replace(/\.$/, '');
}

export function isRedirectedHost(value: string | null | undefined): boolean {
  return REDIRECTED_HOSTS.has(normaliseHost(value));
}

/** The www URL for a request path and query. The fragment never reaches the server. */
export function canonicalLocation(url: URL): string {
  return `${CANONICAL_ORIGIN}${url.pathname}${url.search}`;
}

/**
 * The redirect target for a request, or null when the request already uses
 * www or any other host. The Host header is checked first because it is
 * what the edge routed on; the parsed URL is a fallback for runtimes that
 * rebuild the URL from it.
 */
export function redirectTarget(request: Request, url: URL = new URL(request.url)): string | null {
  const header = request.headers.get('host');
  if (!isRedirectedHost(header) && !isRedirectedHost(url.host)) return null;
  return canonicalLocation(url);
}

/** A bodiless 301. The edge never stores it: the adapter marks it no-store. */
export function permanentRedirect(location: string): Response {
  return new Response(null, { status: 301, headers: { location } });
}
