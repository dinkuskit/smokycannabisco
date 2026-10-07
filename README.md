# smokycannabisco.com

Astro + EmDash (Cloudflare) marketing site for
[smokycannabisco.com](https://www.smokycannabisco.com/) — the Smoky Mountain CBD
intercept/landing domain.

It states clearly that this site is **not** Great Smoky Cannabis Company (GSCC,
tribal recreational dispensary on the Qualla Boundary, in-store only) and routes
shoppers to shippable hemp products on
[smokymountaincbd.com](https://www.smokymountaincbd.com/).

## Seed vs live CMS

| | Seed (`seed/seed.json`) | Live CMS |
| --- | --- | --- |
| Meaning | **Next** iteration (candidate) | **Last safe** iteration serving production |
| Public pages | Only when **no** CMS entry exists yet (cold start) | Prefer whenever an entry exists |
| After failed sync | Stays a candidate; must **not** override CMS | Keeps serving last safe content |

`src/content/load-page.ts` implements that preference and marks
`data-content-source="cms"` or `"seed"`.

After every production deploy with Access configured, the maintainer:

1. `npm run cms:sync` — apply the seed candidate into the CMS and publish.
2. `npm run check:live` — prove the live homepage matches a seed render of that build.

Until sync + live proof succeed, CMS (last safe) wins over a newer seed.
Details: [docs/cms-access.md](docs/cms-access.md), [AGENTS.md](AGENTS.md).

## Run locally

Node from `.nvmrc` (≥ 22.14):

```sh
npm ci
npm run dev
```

Dev server defaults to [http://127.0.0.1:45321](http://127.0.0.1:45321). The
homepage renders from `seed/seed.json` until the local CMS holds an entry.
`/_emdash/admin` works in development; production builds deny that namespace
unless Cloudflare Access is configured.

```sh
npm run build
npm run start   # production build on local workerd — does not deploy
```

## Verify

```sh
npm run verify
```

Runs repo audit, Wrangler types, Astro check, content/guard/edge tests, build,
and smoke against local workerd (seed-rendered HTML with H1/body, real
`sitemap.xml` + `og-image.jpg`, `/_emdash` 404, apex→www redirect).

On demand (needs network / Access login for CMS):

| Script | Purpose |
| --- | --- |
| `npm run cms:check` | Read-only: seed candidate vs live CMS drift |
| `npm run cms:sync` | Apply seed → CMS, publish, re-check |
| `npm run check:live` | Live `<main>` equals seed render of this build |

Identity for check/sync: your Cloudflare Access login via `cloudflared` (see
the runbook). Never commit tokens or Access values.

## Canonical host & SEO

- Canonical: `https://www.smokycannabisco.com` (no trailing slash on `/` beyond path `/`).
- Apex `smokycannabisco.com` → permanent redirect to www (document in Cloudflare
  / Worker middleware; this repo implements the Worker redirect).
- Real SSR HTML for `/`, route handler for `/sitemap.xml`, committed
  `/og-image.jpg` (1200×630).
- Outbound store UTMs:
  `utm_source=smokycannabisco&utm_medium=referral&utm_campaign=gscc_intercept&utm_content=…`
- Analytics: optional / docs-only. Store already has GA4 `G-Q1FG6B6CR4`; do not
  invent a measurement ID for this domain without an explicit flag.

## Maintainer deploy / Access gates

Agents and this README do **not** deploy or create Cloudflare resources.
Maintainer-only steps (D1, R2, Access app, secrets, `wrangler deploy`, post-deploy
`cms:sync` + `check:live`) are in [docs/cms-access.md](docs/cms-access.md).

## Stack

- Astro 7 + EmDash `1.2.0` + `@emdash-cms/cloudflare` `1.2.0`
- Cloudflare Workers, D1, R2
- Content schema and copy: `seed/seed.json` only
