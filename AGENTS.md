# Agent Contract

This repository owns **smokycannabisco.com**: a small Astro + EmDash site on
Cloudflare that clarifies this domain is **not** Great Smoky Cannabis Company
(GSCC) and routes people to shippable hemp products on
[smokymountaincbd.com](https://www.smokymountaincbd.com/).

Assume every committed byte may be public. Do not scrape or impersonate GSCC
branding or assets.

## Source priority

1. This file.
2. `docs/cms-access.md` (Access bootstrap, deploy gates, sync runbook).
3. `seed/seed.json` (candidate content + block schema).
4. Current source and tests.

## Seed vs live CMS (non-negotiable)

| Layer | Role |
| --- | --- |
| **Seed** (`seed/seed.json`) | The **next** iteration — the candidate schema and copy we intend to put onto the live CMS. |
| **Live CMS** | The **last safe** migration — the last good iteration currently serving production. |

Public rendering rules (`src/content/load-page.ts`):

1. If a CMS entry exists and is readable → **serve CMS** (`data-content-source="cms"`).
2. If there is **no** CMS entry yet (cold start / first boot before a successful sync) → serve seed (`data-content-source="seed"`).
3. If `cms:sync` or a migration **fails**, production must **keep serving the last safe CMS**. Seed must **not** automatically override a good CMS entry with a newer unproven iteration.
4. Seed is **not** “sync failed, so show seed.” Seed is the candidate to apply; CMS is what the public sees once an entry exists.

How the new seed becomes the new safe CMS (maintainer, after deploy):

1. `npm run cms:sync` — write seed into CMS and publish.
2. `npm run check:live` — prove live `<main>` equals a seed render of that build.
3. Only after both succeed is the seed the new last-safe CMS.

`npm run cms:check` is read-only drift detection (seed candidate vs CMS).

## EmDash / content rules

- The seed declares `blockTypes`, the `pages` collection, and home content. Every
  editable marketing string is a block field or collection field — not copy that
  lives only in `.astro` files.
- Render layout with EmDash `Blocks` from `emdash/ui` (native EmDash blocks
  only). Do **not** add `@dinkuskit/*` packages.
- Production denies the whole `/_emdash` namespace unless Cloudflare Access is
  configured (fail-closed guard). See `docs/cms-access.md`. Agents do not create
  Cloudflare resources, change DNS, or deploy.
- Pin EmDash and `@emdash-cms/cloudflare` to the current stable 1.x used here
  (`1.2.0` unless deliberately bumped together).

## Product / SEO boundaries

- Transparent intercept tone: we are Smoky Mountain CBD / this domain; we are
  **not** GSCC (tribal recreational dispensary, Qualla Boundary, in-store only).
- Outbound store links use live category URLs and the UTM pattern
  `utm_source=smokycannabisco&utm_medium=referral&utm_campaign=gscc_intercept`
  (plus `utm_content=…`). Prefer www store host. Do not link the known-dead
  `/product-category/concentrates/` path.
- Canonical host is **www**; apex permanently redirects to www.
- Homepage must SSR real H1/body (no SPA shell). Real `/sitemap.xml` and a real
  image at `/og-image.jpg`.
- Do not invent analytics IDs. Store GA4 `G-Q1FG6B6CR4` is documented only;
  enable a tag on this domain only behind an explicit config flag when ready.

## Hard gates (maintainer only)

Merges that publish; creating or changing any Cloudflare Worker, D1, R2, KV,
DNS record, route, custom domain or Access application for smokycannabisco.com;
`wrangler deploy`; EmDash setup, editor accounts and secrets; anything that
publishes; spending Semrush or other paid SEO credits from this agent session.
