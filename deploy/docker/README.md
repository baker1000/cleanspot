# Self-hosting CleanSpot with Docker

For a municipality (or its IT service provider) that wants to run CleanSpot on its own servers,
with no external provider for data and photos.

> **Status: written, not yet tested.** These files and steps have not been run end to end (the
> development machine has no Docker). Treat the first installation as a test installation and
> run through "Check the installation" below. The cloud setup (Supabase cloud) is tested.

## What runs

```
                     ┌────────────── reverse proxy with TLS (Caddy / Traefik / nginx) ─────────────┐
 browser / app ────▶ │ cleanspot.example.org → cleanspot-web:8080   api.example.org → kong:8000    │
                     └───────────────────────────────────────────────────────────────────────────┘
 cleanspot-web    nginx with the built app (this folder)
 Supabase stack   official self-hosting setup: Postgres (with PostGIS, pg_cron, pg_net, Vault),
                  Kong, Auth (GoTrue), PostgREST, Storage, Edge Runtime, Studio, ...
```

CleanSpot needs nothing beyond the standard Supabase stack: the schema, functions, RLS, storage
bucket and claim expiry job are all in `supabase/migrations/`.

## Requirements

- Linux server with Docker Engine and Docker Compose v2, about 4 GB RAM, disk for photos
  (each photo ≤ 5 MB, typically 200–400 kB).
- Two DNS names, e.g. `cleanspot.example.org` (app) and `api.example.org` (Supabase API).
- Node.js 22 on the machine you deploy from (for the migrations).

## 1. Supabase

Follow the official guide, <https://supabase.com/docs/guides/self-hosting/docker>. In short:

```bash
git clone --depth 1 https://github.com/supabase/supabase
cp -r supabase/docker supabase-project
cd supabase-project
cp .env.example .env
```

In `supabase-project/.env`:

- Generate **new** secrets as the guide describes: `POSTGRES_PASSWORD`, `JWT_SECRET`, and the
  `ANON_KEY` / `SERVICE_ROLE_KEY` signed with that JWT secret, `DASHBOARD_PASSWORD`,
  `SECRET_KEY_BASE`, `VAULT_ENC_KEY`, `POOLER_TENANT_ID`. Never keep the example values.
- `SITE_URL=https://cleanspot.example.org`, `API_EXTERNAL_URL=https://api.example.org`,
  `SUPABASE_PUBLIC_URL=https://api.example.org`.
- **Anonymous sign-ins on** (reporting without an account needs them):
  `ENABLE_ANONYMOUS_USERS=true`. If your version of the setup has no such variable, add
  `GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: "true"` to the `auth` service in
  `docker-compose.yml`. Also set a rate limit for anonymous sign-ins there:
  `GOTRUE_RATE_LIMIT_ANONYMOUS_USERS: "30"` (per hour and IP, as on the cloud).
- E-mail (account confirmation): the `SMTP_*` values of your mail server. CleanSpot works without
  e-mail for anonymous reporting; accounts need it.

```bash
docker compose pull
docker compose up -d
```

## 2. Database: CleanSpot migrations

From a checkout of this repository, with the database reachable (port 5432 of the Supabase
pooler; open it only to your deploy machine, or run this on the server):

```bash
npm ci
npx supabase db push --db-url "postgresql://postgres.<POOLER_TENANT_ID>:<POSTGRES_PASSWORD>@<server>:5432/postgres"
```

This creates the schema, the functions, all RLS policies, the public tenant, the private storage
bucket `report-photos` and the hourly claim expiry job (pg_cron). Run it again after every
update; only new migrations are applied.

## 3. Maintenance function

Deletes orphan photo files through the Storage API (claim expiry also runs without it):

1. Copy the function into the stack:
   ```bash
   cp -r supabase/functions/maintenance supabase/functions/_shared supabase-project/volumes/functions/
   ```
2. Give the `functions` service a secret: add `MAINTENANCE_SECRET: <random, e.g. openssl rand -hex 32>`
   to its `environment` in `docker-compose.yml`, then `docker compose up -d functions`.
3. In Studio → SQL editor (Studio is at the Kong URL, protected by `DASHBOARD_PASSWORD`):
   ```sql
   select vault.create_secret('http://kong:8000/functions/v1/maintenance', 'maintenance_url');
   select vault.create_secret('<the same secret>', 'maintenance_secret');
   create extension if not exists pg_net;
   ```
   then schedule the job with the `cron.schedule('cleanspot-maintenance', …)` statement from
   [supabase/functions/maintenance/README.md](../../supabase/functions/maintenance/README.md).
   The URL uses the stack's internal name `kong`, so the call never leaves the server.

## 4. Municipality, staff, settings

In the SQL editor (as `postgres`), for example:

```sql
-- The municipality with its area (MultiPolygon, lng lat, WGS 84). Use the official border,
-- e.g. exported from the state's open data portal or OpenStreetMap (boundary relation).
insert into public.tenants (slug, name, kind, area, contact_email)
values ('lk-harburg', 'Landkreis Harburg', 'municipality',
        'SRID=4326;MULTIPOLYGON(((...)))'::extensions.geography, 'umwelt@example.org');

-- Settings (only what differs from the defaults, see ARCHITECTURE.md):
update public.tenants set settings = '{"bulky_waste_url": "https://...", "claim_expiry_hours": 48}'
where slug = 'lk-harburg';

-- Staff: the person signs up in the app first, then:
insert into public.memberships (user_id, tenant_id, role)
select u.id, t.id, 'municipality_staff' from auth.users u, public.tenants t
where u.email = 'mitarbeiter@example.org' and t.slug = 'lk-harburg';
```

Roles: `municipality_staff`, `municipality_admin` (admins can then manage memberships of their
tenant through the API). An install-wide administrator: `update public.profiles set
is_super_admin = true where id = (select id from auth.users where email = '…');`.

## 5. Web app

On the server, from this repository:

```bash
export VITE_SUPABASE_URL=https://api.example.org
export VITE_SUPABASE_ANON_KEY=<ANON_KEY from supabase-project/.env>   # public by design
docker compose -f deploy/docker/docker-compose.web.yml up -d --build
```

The app listens on `127.0.0.1:8080`. Optional build values: `VITE_MAP_STYLE_URL`,
`VITE_GEOCODER_URL`, `VITE_GEOCODER_COUNTRYCODES`, `VITE_PLAY_STORE_URL` (see `.env.example`).
Never set `VITE_DEMO_MODE` on a real installation.

Rebuild after every update (`… up -d --build`). The service worker shows users "new version
available".

## 6. Reverse proxy with TLS

Example `Caddyfile` (Caddy gets certificates automatically):

```
cleanspot.example.org {
  reverse_proxy 127.0.0.1:8080
}
api.example.org {
  reverse_proxy 127.0.0.1:8000
}
```

Only 80/443 need to be reachable from the internet. Keep Postgres (5432) and Studio closed or
behind a VPN.

## 7. Map and place search (optional, for heavier use)

By default the app uses OpenFreeMap tiles and the public Nominatim server (≤ 1 request/s; the
app enforces it). For a Landkreis-wide rollout, run your own:

- **Tiles:** a [Protomaps](https://docs.protomaps.com/) PMTiles extract of Germany (or
  Niedersachsen) behind any static web server, with a MapLibre style; set `VITE_MAP_STYLE_URL`.
  The service worker caches tiles only from the style's own host.
- **Search:** Nominatim in Docker (e.g. the `mediagis/nominatim` image with a Niedersachsen
  extract); set `VITE_GEOCODER_URL`.

Then update the privacy policy (section 8, services used).

## 8. Backups and updates

- Database: `docker compose exec db pg_dump -U postgres -Fc postgres > cleanspot-$(date +%F).dump`
  (daily, kept encrypted off the server).
- Photos: the storage volume `supabase-project/volumes/storage`.
- Updates: `git pull`, `npx supabase db push --db-url …`, rebuild the web app, copy the function
  again if it changed. Read the release notes of the Supabase setup before pulling new images.

## Check the installation

1. `https://cleanspot.example.org/` shows the landing page with statistics (0 reports).
2. `/app` → **Report**: send a report with a photo **without an account** (proves anonymous
   sign-ins, storage upload, RLS and the functions). It appears on the map.
3. Sign in as staff → **Profile → Pickup route** opens.
4. Studio → Database → Cron jobs: `cleanspot-expire-claims` and `cleanspot-maintenance` exist;
   after the next full hour the job history shows a successful run.
5. Optional, more thorough: the DB and API test suites (`npm run verify:remote`) can run against
   an **empty test instance**: put its values (same names as `supabase-cloud.env.example`;
   `SUPABASE_DB_URL` = the pooler connection string) into `.env.supabase-cloud` on a machine where
   that file does not point to the regular verify project.
