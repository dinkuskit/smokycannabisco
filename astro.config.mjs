import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';
import react from '@astrojs/react';
import { d1, r2, sandbox } from '@emdash-cms/cloudflare';
import { defineConfig } from 'astro/config';
import emdash from 'emdash/astro';

// Build input only. Unset (the default) leaves the /_emdash namespace denied
// in production; see docs/cms-access.md. Never commit a value.
const teamDomain = process.env.EMDASH_ACCESS_TEAM_DOMAIN ?? '';
const siteUrl = process.env.SMOKY_SITE_URL ?? 'https://www.smokycannabisco.com';
const auth = teamDomain
  ? {
      type: 'cloudflare-access',
      entrypoint: './src/emdash-access-auth.ts',
      config: { teamDomain, audienceEnvVar: 'CF_ACCESS_AUDIENCE', defaultRole: 40 },
    }
  : undefined;

// The build's own timestamp: the validator of a seed-rendered page, whose
// content changes only with a deploy (src/page-cache.ts).
const buildTime = new Date().toISOString();

export default defineConfig({
  site: siteUrl,
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  cache: { provider: cacheCloudflare() },
  integrations: [
    react(),
    emdash({
      siteUrl,
      database: d1({ binding: 'DB', session: 'disabled' }),
      storage: r2({ binding: 'MEDIA' }),
      sandboxRunner: sandbox(),
      ...(auth ? { auth } : {}),
      middleware: {
        // Apex → www redirect, then the fail-closed /_emdash guard.
        outer: './src/outer-middleware.ts',
      },
    }),
  ],
  vite: {
    define: {
      'import.meta.env.EMDASH_ACCESS_TEAM_DOMAIN': JSON.stringify(teamDomain),
      'import.meta.env.SMOKY_BUILD_TIME': JSON.stringify(buildTime),
    },
  },
  devToolbar: { enabled: false },
});
