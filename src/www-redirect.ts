import { defineMiddleware } from 'astro:middleware';
import { permanentRedirect, redirectTarget } from './host-canonical.ts';

/**
 * Outermost middleware: smokycannabisco.com (apex) is a pure redirector to
 * www. It runs before the namespace guard so nothing is ever served from the
 * apex host; the guard and the CMS only ever see www.
 */
export const onRequest = defineMiddleware((context, next) => {
  const target = redirectTarget(context.request, context.url);
  return target ? permanentRedirect(target) : next();
});
