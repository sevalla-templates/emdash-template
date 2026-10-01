# EmDash on Sevalla

A deploy template for [EmDash](https://docs.emdashcms.com/), the TypeScript CMS built on Astro, that
uses every part of [Sevalla](https://sevalla.com) a CMS benefits from:

| Sevalla product | What it does here |
| --- | --- |
| **Application Hosting** | Runs the Astro/EmDash server from the included `Dockerfile`. The container is stateless, so you can scale it horizontally. |
| **Managed PostgreSQL** | Stores content, users, settings and **sessions**, and searches posts with Postgres full-text search. Sevalla backs it up daily. |
| **Object Storage** | Stores uploaded media. The admin uploads straight to the bucket with presigned URLs, and visitors load media from the bucket's CDN domain. |
| **Edge Caching** | Serves rendered pages from Cloudflare's 260+ locations. When an editor publishes, the app purges the edge cache through the Sevalla API. |
| **CDN** | Serves the hashed JS/CSS/font assets under `/_astro/` from Cloudflare with immutable caching. |

The site is EmDash's official **blog** template (posts, pages, categories, tags, search, RSS,
comments, dark mode), with the hosting layer adapted for Sevalla.

```text
                 ┌──────────── Cloudflare (Sevalla) ────────────┐
 visitor ──────▶ │ Edge Caching: HTML     CDN: /_astro/* assets  │──┐ cache miss
                 └───────────────────────────────────────────────┘  │
                                                                    ▼
 editor ─── /_emdash/admin ───────────────────────────────▶ Application (Node, :8080)
    │                                                          │        │
    │  presigned PUT                     internal connection   │        │ POST /purge-cache
    ▼                                                          ▼        ▼ on publish
 Object Storage ◀── media reads ── <bucket>.sevalla.storage   PostgreSQL   Sevalla API
```

---

## Deploy to Sevalla

Create all three resources in the **same region**. Internal connections between an app and a
database only work within one region.

### 1. Create the database

**Databases → Create database → PostgreSQL** (version 16 or newer). Sevalla creates the database
user as the owner of the database, which is what EmDash needs: it creates and alters its own tables
as you change the content model.

### 2. Create the bucket

1. **Object Storage → Create bucket.**
2. Under **Settings → CDN domain**, enable the public domain. Media is then served from
   `https://<bucket>.sevalla.storage`.
3. Under **Settings → CORS policies**, add one rule so the admin can upload from the browser:
   - **Origins:** your app URL, e.g. `https://emdash-abc12.sevalla.app` (add custom domains later)
   - **Methods:** `PUT`, `GET`, `HEAD`
   - **Headers:** `content-type`
4. Note the **Endpoint**, **Bucket name**, **Access key** and **Secret key** from **Settings**.

### 3. Create the application

1. **Applications → Create application**, connect this repository and the branch to deploy.
2. **Build:** choose **Dockerfile** (path `Dockerfile`, context `.`). The image needs no
   build-time variables.
3. Keep the default web process. The container listens on Sevalla's `$PORT` (8080).

### 4. Connect the database

On the database, go to **Networking → Add internal connection**, pick the application, and tick
**Add environment variables to the application** (runtime). Rename the connection-URL key to
`DATABASE_URL`. The app also accepts `DB_URL`, or `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`,
but `npm run migrate` and the EmDash CLI read `DATABASE_URL`.

If you create the connection through the API or CLI instead, no variables are added. Set
`DATABASE_URL` yourself:
`postgres://<user>:<password>@<internal hostname>:5432/<database>`. The internal hostname is on
the database's overview page.

### 5. Set environment variables

Under **Applications → your app → Environment variables** (runtime):

| Variable | Value |
| --- | --- |
| `EMDASH_SITE_URL` | Public URL, e.g. `https://emdash-abc12.sevalla.app`. Set it **before** running setup: passkeys are tied to this origin. |
| `EMDASH_ENCRYPTION_KEY` | Output of `npx emdash secrets generate`. Encrypts plugin secrets. Keep a copy. |
| `S3_ENDPOINT` | Bucket endpoint, e.g. `https://<account>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | Bucket name |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Bucket keys |
| `S3_REGION` | `auto` |
| `S3_PUBLIC_URL` | `https://<bucket>.sevalla.storage` (the CDN domain from step 2) |
| `SEVALLA_APP_ID` | The application's ID (shown in the app's **Settings**, or via `sevalla apps list`) |
| `SEVALLA_API_KEY` | An API key from **Company settings → API keys**. Give it a single capability, `APP:UPDATE`, limited to this application. |

[`.env.example`](.env.example) documents every variable, including the optional ones.

### 6. Turn on CDN and Edge Caching

**Applications → your app → Networking → CDN & Edge caching → Update settings**, and enable
both **CDN** and **Edge caching**.

### 7. Deploy and run setup

Deploy, then open `https://<your-app>/_emdash/admin`. The setup wizard creates the site, optionally
loads the demo content, and registers your admin passkey. Migrations run automatically on the
first request.

### Optional extras

- **Health checks.** In **Processes → web → Update process**, set the liveness probe to `/healthz`
  and the readiness probe to `/healthz?db=1` (it also checks PostgreSQL).
- **Release job.** Add a **Job** process with **Start policy: Before deployment** and start command
  `npm run migrate`. EmDash's core migrations then run once per deploy, before new pods take
  traffic. Without the job, the web process applies them on the first request, holding a lock.
- **Scaling.** The container keeps no state, so you can raise the instance count or enable
  autoscaling. Sessions live in PostgreSQL, so editors stay signed in on every pod and across
  deploys.
- **Custom domain.** After adding it, update `EMDASH_SITE_URL`, add the origin to the bucket's CORS
  rule, and redeploy. Passkeys registered on the old origin won't work on the new one. Register a
  passkey on the new domain before you remove the old one.

---

## How caching works

| Response | Cached where | Invalidated by |
| --- | --- | --- |
| Pages (`/`, `/posts/*`, `/category/*`, …) | Edge, `s-maxage=3600`, `stale-while-revalidate=86400` | Purge on publish, edit, delete, schedule, menu/settings change |
| `/_astro/*` (hashed JS, CSS, fonts) | CDN + browsers, 1 year, immutable | New hashes on each build |
| Media (`<bucket>.sevalla.storage/*`) | Object Storage CDN | New uploads get new keys |
| `/_emdash/*` (admin, API, auth), previews, `?_edit` | Not cached (`private, no-store`) | — |

- **Opt-in caching.** Only routes that pass EmDash cache hints to `Astro.cache.set()` get a shared
  `Cache-Control`. The cache provider lives in [`src/sevalla/edge-cache.ts`](src/sevalla/edge-cache.ts).
- **Purging.** EmDash calls `cache.invalidate()` after every content change. Sevalla purges a whole
  application at once, so [`src/sevalla/purge.ts`](src/sevalla/purge.ts) coalesces a burst of edits
  into one API call, sent at most every 10 seconds. A small EmDash plugin
  ([`src/sevalla/plugin.ts`](src/sevalla/plugin.ts)) also purges when a **scheduled** post goes
  live, which happens outside any request. Sevalla also purges both caches after every deploy.
  A purge can take a couple of minutes to reach every Cloudflare location.
- **Signed-in users.** EmDash runs with `toolbar: "client"`, so public HTML is identical for every
  visitor. Editors get an **Edit** pill that loads a fresh, uncached view. As a safeguard, a
  response is never marked shareable if the request carries a session cookie or the response sets
  one. The blog's comment form, for example, prints the signed-in user's name and email.
- **Tuning.** `EDGE_CACHE_MAX_AGE` and `EDGE_CACHE_SWR` (seconds) change the TTLs at runtime.
  `EDGE_CACHE_MAX_AGE=0` turns off page caching.

Without `SEVALLA_APP_ID`/`SEVALLA_API_KEY`, nothing purges the edge cache. Pages then update when
`s-maxage` expires, and the app logs a warning on the first content change.

---

## Local development

Requires Node.js 22.16+ and Docker. [`docker-compose.yml`](docker-compose.yml) runs PostgreSQL and an
S3-compatible store ([RustFS](https://rustfs.com)) that stand in for the Sevalla services.

```bash
npm install
cp .env.example .env
docker compose up -d db s3 createbucket
npm run dev
```

- Site: <http://localhost:4321>
- Admin: <http://localhost:4321/_emdash/admin>. In development,
  <http://localhost:4321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin> skips the setup wizard.
- Storage console: <http://localhost:9001> (`s3admin` / `s3admin-secret`)

Run the production image against the same services:

```bash
docker compose up --build
```

It serves on <http://localhost:8080>. Recreate the app container
(`docker compose up -d --force-recreate app`) and nothing is lost, because all state lives in
Postgres and the bucket. `docker compose down -v` wipes everything.

The dev server never caches pages; Astro's route cache only runs in production builds.

---

## Project layout

```text
├── astro.config.mjs          # EmDash + Sevalla wiring (db, storage, sessions, cache, proxy)
├── Dockerfile                # secret-free multi-stage build, Node 24, listens on $PORT
├── server.mjs                # production entrypoint: drops spoofable X-Forwarded-Host, graceful shutdown
├── docker-compose.yml        # local Postgres + S3 + production image
├── .env.example              # every environment variable, documented
├── scripts/migrate.mjs       # non-interactive `emdash migrate` for a pre-deploy Job
├── seed/seed.json            # content model + demo content
└── src/
    ├── sevalla/
    │   ├── database.ts       # Postgres dialect that reads DATABASE_URL at runtime
    │   ├── session-driver.ts # Astro sessions in Postgres (stateless, multi-instance)
    │   ├── edge-cache.ts     # Astro cache provider for Sevalla Edge Caching
    │   ├── purge.ts          # coalesced calls to the Sevalla purge-cache API
    │   ├── plugin.ts         # purges when scheduled posts publish
    │   ├── search.ts         # Postgres full-text search for /search
    │   ├── pg.ts / env.ts    # shared pool + runtime env helpers
    ├── pages/healthz.ts      # liveness / readiness probe
    ├── pages/, layouts/, components/  # the EmDash blog theme
```

## Differences from the stock EmDash blog template

- **PostgreSQL instead of SQLite, S3 instead of local files.** The app needs no persistent disk,
  so it can run several instances. Credentials are read at runtime, never baked into the build.
- **Search uses PostgreSQL.** EmDash's built-in `search()` and live-search widget use SQLite FTS5
  and return nothing on PostgreSQL. `/search` and the header search box use
  [`src/sevalla/search.ts`](src/sevalla/search.ts) instead: ranked, stemmed matching on title,
  excerpt and body text. Language is set by `SEARCH_TS_CONFIG` (default `english`). It's fine for
  thousands of posts; beyond that, add an expression GIN index on the same `tsvector`.
- **Sessions in PostgreSQL** (`sevalla_astro_sessions` table) instead of the local filesystem.
- **Proxy-aware.** Astro takes the scheme from `X-Forwarded-Proto`, which Sevalla sets. The host
  comes from `Host`, which Cloudflare routes on. [`server.mjs`](server.mjs) discards a
  client-supplied `X-Forwarded-Host`, which Sevalla passes through unchanged. Otherwise one
  request could poison edge-cached pages with links to another domain. EmDash takes the client IP
  from `CF-Connecting-IP` for rate limiting.

## Notes

- **Backups.** Sevalla backs up the database daily (**Databases → Backups**). EmDash's own
  "automatic backups" setting writes JSON archives into the media bucket under `backups/`. With
  the bucket's public CDN domain enabled, those files are reachable by anyone who guesses the
  name. Leave EmDash's automatic backups off, or leave `S3_PUBLIC_URL` empty so media is served
  through the app.
- **Images.** EmDash on Node serves original uploads without resizing, so upload web-sized images.
- **Updating EmDash.** Bump `emdash` (and `astro`) in `package.json`, run `npm install`, and
  redeploy. Pending core migrations apply automatically, or in the release job.

## Learn more

- [EmDash documentation](https://docs.emdashcms.com/)
- [Sevalla documentation](https://docs.sevalla.com/): [Edge caching](https://docs.sevalla.com/applications/edge-caching),
  [CDN](https://docs.sevalla.com/applications/cdn), [Object storage](https://docs.sevalla.com/object-storage/overview),
  [Databases](https://docs.sevalla.com/databases/overview)
- [`AGENTS.md`](AGENTS.md): notes for coding agents working on this site

## License

MIT. The blog theme and seed content come from [emdash-cms/templates](https://github.com/emdash-cms/templates) (MIT).
