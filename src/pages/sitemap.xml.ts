import type { APIRoute } from 'astro';
import seed from '../../seed/seed.json';

const CANONICAL = 'https://www.smokycannabisco.com';
const pages = (seed as { content?: { pages?: Array<{ slug?: string; status?: string }> } }).content?.pages ?? [];

function xml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  })[character] ?? character);
}

/** Real XML sitemap — not an SPA HTML shell. */
export const GET: APIRoute = () => {
  const urls = pages
    .filter((page) => (page.status ?? 'published') === 'published' && page.slug)
    .map((page) => {
      const path = page.slug === 'home' ? '/' : `/${page.slug}`;
      return `  <url>\n    <loc>${xml(`${CANONICAL}${path}`)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${page.slug === 'home' ? '1.0' : '0.7'}</priority>\n  </url>`;
    })
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
