import { isSafeHref } from 'emdash';

export interface SeedBlock {
  _type: string;
  _version: number;
  _key: string;
  [field: string]: unknown;
}

/** A string field of a block, or '' when missing or not a string. */
export function stringField(value: Record<string, unknown>, field: string): string {
  const raw = value[field];
  return typeof raw === 'string' ? raw : '';
}

/**
 * A link target that is safe to render: a site-relative path or an http(s)
 * URL, checked with EmDash's own `isSafeHref`. Anything else renders no link.
 */
export function safeHref(value: unknown): string {
  if (typeof value !== 'string') return '';
  const href = value.trim();
  if (!href) return '';
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  return /^https?:\/\//i.test(href) && isSafeHref(href) ? href : '';
}
