import seed from '../../seed/seed.json';
import type { SeedBlock } from './blocks';

export type { SeedBlock } from './blocks';

export interface PageData {
  title: string;
  description: string;
  brand_name: string;
  nav_label: string;
  nav_href: string;
  footer_text: string;
  og_image_alt: string;
  layout: SeedBlock[];
}

interface SeedPage {
  slug: string;
  status?: string;
  data: PageData;
}

const pages = (seed as { content: { pages: SeedPage[] } }).content.pages;

/** The page as shipped in seed/seed.json, or null when the slug is unknown. */
export function seedPage(slug: string): PageData | null {
  const page = pages.find((entry) => entry.slug === slug && (entry.status ?? 'published') === 'published');
  return page ? page.data : null;
}
