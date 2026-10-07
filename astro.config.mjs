import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';
import react from '@astrojs/react';
import { access, d1, r2, sandbox } from '@emdash-cms/cloudflare';
import { defineConfig } from 'astro/config';
import emdash from 'emdash/astro';

// Build input only. Unset (the default) leaves the /_emdash namespace denied
// in production; see docs/cms-access.md. Never commit a value.
const teamDomain = process.env.EMDASH_ACCESS_TEAM_DOMAIN ?? '';

// The build's own timestamp: the validator of a seed-rendered page, whose
// content changes only with a deploy (src/page-cache.ts).
const buildTime = new Date().toISOString();

export default defineConfig({
  site: 'https://www.smokycannabisco.com',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  cache: { provider: cacheCloudflare() },
  integrations: [
    react(),
    emdash({
      siteUrl: 'https://www.smokycannabisco.com',
      database: d1({ binding: 'DB', session: 'disabled' }),
      storage: r2({ binding: 'MEDIA' }),
      sandboxRunner: sandbox(),
      ...(teamDomain
        ? { auth: access({ teamDomain, audienceEnvVar: 'CF_ACCESS_AUDIENCE', defaultRole: 40 }) }
        : {}),
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
