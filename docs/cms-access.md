# CMS access runbook

Reviewable preparation only. Nothing here creates Cloudflare resources,
enables Access, deploys, or changes DNS. Every step below is a maintainer
action.

## Seed vs live CMS

- **Seed** = next iteration (candidate copy + block schema in `seed/seed.json`).
- **Live CMS** = last safe migration currently serving production.
- Public pages prefer CMS when an entry exists (`src/content/load-page.ts`).
- Seed boots the site only when there is **no** CMS entry yet.
- A failed `cms:sync` must leave production on the last safe CMS; do not
  treat seed as an override for a good CMS entry.
- After a successful deploy: `cms:sync` then `check:live` — only then is the
  seed the new last-safe CMS.

## How production behaves

- `src/outer-middleware.ts`: apex → www redirect first
  (`smokycannabisco.com` → `https://www.smokycannabisco.com`, path and query
  preserved, `/_emdash` included), then the namespace guard.
- `src/emdash-namespace-guard.ts` runs before EmDash. In production builds it
  answers 404 for every path under `/_emdash`, including setup and login,
  unless **all** of these hold:
  - the build set `EMDASH_ACCESS_TEAM_DOMAIN`, which wires EmDash's official
    `access()` auth in `astro.config.mjs` and is compiled into the guard,
  - the Worker has the `CF_ACCESS_AUDIENCE` secret,
  - the request carries a valid Cloudflare Access JWT for that audience, and
  - when `EMDASH_OPERATOR_ALLOWLIST` is set, the identity's email is on it.
- The guard reads the audience and allowlist from Worker `env` / `process.env`.
  A failed read counts as not configured.
- `wrangler.jsonc` declares a `worker_loaders` binding (`LOADER`) for EmDash
  `sandbox()`. On a free plan remove that binding and `sandbox()` (this site
  does not need sandboxed plugins).
- Edge cache: Astro route cache with the Cloudflare provider; public pages opt
  in from `src/page-cache.ts`. `/_emdash`, 404s, and redirects stay no-store.

## Values that stay out of source

Set only as Wrangler secrets, in ignored `.dev.vars`, or in a local overlay.
Do not add a `.env` to the repository.

- `EMDASH_ACCESS_TEAM_DOMAIN`: build input only (`<team>.cloudflareaccess.com`).
- `CF_ACCESS_AUDIENCE`: runtime Access audience tag.
- `EMDASH_OPERATOR_ALLOWLIST`: runtime comma-separated operator emails.
- `EMDASH_ENCRYPTION_KEY`: EmDash plugin-secret key (`npx emdash secrets generate`).

Account, zone, database and bucket identifiers stay out of source; the ids in
`wrangler.jsonc` are local placeholders.

## Human bootstrap order

1. **Zero Trust team** in the Cloudflare dashboard.
2. **Access application** (Self-hosted):
   - Name: `SmokyCannabisCo CMS` (or similar).
   - Public hostnames: `www.smokycannabisco.com` path `_emdash`, and
     `smokycannabisco.com` path `_emdash` (apex redirects to www; cover both).
   - Policy: maintainer owners only until setup is closed.
   - Save and note the application's AUD tag.
3. **Secrets** (values never pasted into chat):

   ```sh
   npx wrangler secret put CF_ACCESS_AUDIENCE --name smokycannabisco-site
   npx wrangler secret put EMDASH_OPERATOR_ALLOWLIST --name smokycannabisco-site
   npx emdash secrets generate --write .local/secrets.env
   grep '^EMDASH_ENCRYPTION_KEY=' .local/secrets.env | cut -d= -f2- | npx wrangler secret put EMDASH_ENCRYPTION_KEY --name smokycannabisco-site
   ```

4. **Team domain for the build** in ignored `.local/deploy.env`:
   `EMDASH_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com`
5. **Build and deploy** (maintainer):

   ```sh
   set -a; . ./.local/deploy.env; set +a
   npm run build
   SMOKY_CUSTOM_DOMAIN=www.smokycannabisco.com,smokycannabisco.com npm run prepare:deploy
   npx wrangler deploy --config dist/server/wrangler.production.json
   ```

6. **First login and setup** at `https://www.smokycannabisco.com/_emdash/admin`.
   EmDash setup may import the seed once; afterward CMS entries are the last
   safe public content until the sync workflow below.
7. **Sync seed → CMS** after every deploy that changes seed or components:

   ```sh
   cloudflared access login https://www.smokycannabisco.com/_emdash
   npm run cms:sync
   npm run check:live
   ```

## Keeping the CMS equal to the seed candidate

| Command | What it does |
| --- | --- |
| `npm run cms:check` | Reports drift between seed (candidate) and CMS (last safe). Exit 1 on drift. Read only. |
| `npm run cms:sync` | Writes seed into CMS, publishes, re-checks. Never deletes. |
| `npm run check:live` | After `npm run build`: local seed render vs live `<main>`. |

Default origin: `https://www.smokycannabisco.com`.

If sync fails mid-way, fix and re-run; public pages continue to prefer whatever
valid CMS entry still exists (last safe). Do not force seed over CMS.

## Deploying the public pages (maintainer, gated)

1. `npx wrangler login`
2. Create resources once:

   ```sh
   npx wrangler d1 create smokycannabisco-site-cms
   npx wrangler r2 bucket create smokycannabisco-site-media
   ```

   Export the printed database id as `SMOKY_D1_ID` in an ignored local file.
3. Build, prepare production config, deploy:

   ```sh
   npm run build
   SMOKY_D1_ID=... SMOKY_WORKERS_DEV=true npm run prepare:deploy
   npx wrangler deploy --config dist/server/wrangler.production.json
   ```

   Free plan: add `SMOKY_SANDBOX=false` to drop `worker_loaders`.
4. Attach custom domains with
   `SMOKY_CUSTOM_DOMAIN=www.smokycannabisco.com,smokycannabisco.com`.
5. After Access is configured: `cms:sync` then `check:live` on every deploy.
