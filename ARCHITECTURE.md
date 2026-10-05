# CleanSpot — Architecture

CleanSpot is one React + TypeScript web app (website, PWA, and via Capacitor the Android and iOS
apps) on a Supabase backend (PostgreSQL + PostGIS, Auth, Storage, Edge Functions). Every
permission is enforced in the database with Row Level Security (RLS) and `security definer`
functions; the UI only hides what the database would refuse anyway.

```
┌───────────────────────────┐        ┌──────────────────────────────────────────────┐
│ React app (Vite)          │  HTTPS │ Supabase (EU region, or self-hosted Docker)  │
│  website + PWA            │───────▶│  PostgREST  → views + RPC functions + RLS    │
│  Android/iOS (Capacitor)  │        │  Auth       → email/password, anonymous      │
│  IndexedDB offline queue  │        │  Storage    → bucket report-photos (private) │
│  service worker (web)     │        │  Edge Fn    → maintenance (hourly, pg_cron)  │
└───────────┬───────────────┘        └──────────────────────────────────────────────┘
            │ map tiles / place search
            ▼
   OpenFreeMap (OSM tiles), Nominatim (OSM geocoding) — both replaceable by self-hosted ones
```

## Folder structure

| Path                              | Content                                                                                                                                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`                        | App shell, routes, layout, PWA update prompt, offline notice                                                                                                                                                                                                                       |
| `src/features/<feature>/`         | One folder per feature: page component, API module (Supabase calls), context for injecting a fake API in tests, tests next to the code. Features: `map`, `report` (incl. `outbox/` offline queue), `detail`, `pickups`, `profile`, `auth`, `landing`, `legal`, `geocoding`, `demo` |
| `src/components/`                 | Shared UI (buttons, alerts, inputs, icons, language select)                                                                                                                                                                                                                        |
| `src/lib/`                        | Env parsing, Supabase client, IndexedDB, geolocation, Capacitor bridge (`native.ts`)                                                                                                                                                                                               |
| `src/i18n/`                       | i18next setup, `locales/<lang>.json` for de (default), en, ar (RTL), fr, tr, uk                                                                                                                                                                                                    |
| `src/sw/`                         | Service worker (Workbox): precache, map tile cache, Background Sync                                                                                                                                                                                                                |
| `supabase/migrations/`            | The whole database: schema, functions, RLS, grants, storage bucket                                                                                                                                                                                                                 |
| `supabase/functions/maintenance/` | Edge Function: claim expiry, orphan photo cleanup                                                                                                                                                                                                                                  |
| `supabase/demo/`                  | Demo data (`seed.sql`, `remove.sql`, `accounts.json`)                                                                                                                                                                                                                              |
| `supabase/tests/lite/`            | DB tests: PGlite (default) or a real Supabase database (`verify:remote`)                                                                                                                                                                                                           |
| `tests/remote-api/`               | API tests against a real Supabase project (PostgREST, Storage, Edge Function)                                                                                                                                                                                                      |
| `e2e/`                            | Playwright tests (main flows, offline, PWA, accessibility with axe)                                                                                                                                                                                                                |
| `android/`, `ios/`                | Capacitor native projects (`store.thinktools.cleanspot`)                                                                                                                                                                                                                           |
| `scripts/`                        | Cloud setup, demo data, icons, Android signing (no secrets are ever printed)                                                                                                                                                                                                       |

## Multi-tenancy

One installation serves several municipalities and the public at once.

- **`tenants`**: either the single **public** tenant (`kind = 'public'`, no area) or a
  **municipality** (`kind = 'municipality'`, `area` = MultiPolygon). A check constraint enforces
  "municipality ⇔ has an area".
- **Routing:** `tenant_for_point(point)` picks the **smallest** municipality whose area covers the
  point, else the public tenant. `submit_report` stores that tenant on the report, so a report
  inside Landkreis Harburg belongs to Landkreis Harburg and is handled by its staff; anywhere
  else the community handles it.
- **Settings per tenant** (`tenants.settings`, merged over `default_tenant_settings()`):
  `auto_approve_confirmations` (3), `duplicate_radius_m` (30), `cleanup_radius_m` (50),
  `allow_volunteer_claims`, `claim_expiry_hours` (72), `reports_per_hour_anonymous` (5) /
  `_registered` (20), `kg_per_size`, `kg_per_bag` (6), `bag_drop_radius_m` (300),
  `max_bags_per_drop` (30), `bulky_waste_url`, `gamification_enabled`, `leaderboard_enabled`,
  `hotspot_threshold` / `hotspot_window_days` (Milestone 2).

## Roles

| Role               | Stored as                                                                      | Can                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| citizen            | nothing: any signed-in user without a membership, incl. **anonymous** sessions | report (anonymous: 5/h), confirm others' reports (registered only), see own reports                  |
| volunteer          | `memberships(role = volunteer)` in the public tenant (self-service opt-in)     | claim and clear non-hazardous reports (where the tenant allows volunteers), after-photo, report bags |
| organizer          | `memberships(role = organizer)`                                                | as volunteer; events are Milestone 2                                                                 |
| municipality_staff | `memberships(role = municipality_staff)` in a municipality                     | everything in their tenant: hazardous reports, moderation, status changes, pickup route              |
| municipality_admin | `memberships(role = municipality_admin)`                                       | as staff, plus tenant settings and memberships of their tenant                                       |
| super_admin        | `profiles.is_super_admin` (not a tenant role)                                  | everything, in every tenant; create/delete tenants                                                   |

Anonymous reporting uses Supabase anonymous sign-ins: the device gets a real (anonymous) user, so
the same RLS rules apply, rate limits work per user, and the account can later be upgraded to an
email account keeping its reports.

## Data model

All tables are in `public`, all have RLS enabled. Geometry is `geography(…, 4326)`, so distances
are in metres.

```
tenants 1──n memberships n──1 profiles 1──1 auth.users
   │                              │
   1                              │ reporter / claimed_by / cleared_by / assigned_to
   n                              │
reports ──────────────────────────┘
   │ 1
   ├──n report_photos      (kind before | after | bags; moderation pending | approved | rejected)
   ├──n report_events      (history timeline)
   ├──n report_confirmations (one per user)
   ├──n pickup_tasks       (bags waiting for municipal pickup)
   └──0..1 duplicate_of → reports
```

| Table                  | Key columns                                                                                                                                                                                                                                                                                                                               | Notes                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`              | `slug`, `name`, `kind`, `area`, `settings`, `contact_email`                                                                                                                                                                                                                                                                               | slug/kind/area changeable by super admins only (trigger)                                                                        |
| `profiles`             | `display_name`, `locale`, `easy_mode`, `is_super_admin`, `blocked_until`                                                                                                                                                                                                                                                                  | created by trigger for every auth user; email stays in `auth.users` only; `is_super_admin`/`blocked_until` protected by trigger |
| `memberships`          | `user_id`, `tenant_id`, `role`                                                                                                                                                                                                                                                                                                            | primary key (user, tenant): one role per tenant                                                                                 |
| `reports`              | `client_id` (device-generated, unique → idempotent offline sync), `tenant_id`, `reporter_id`, `location`, `accuracy_m`, `category`, `hazard_type`, `is_hazardous` (generated), `size`, `comment` (≤ 500), `status`, `duplicate_of`, `is_published`, `confirmation_count`, `estimated_kg`, `claimed_by/at`, `assigned_to`, `cleared_by/at` | status: reported → confirmed → in_progress → cleared, or rejected / duplicate                                                   |
| `report_photos`        | `storage_path` (`<uploader uid>/<uuid>.webp`), `kind`, `uploaded_by`, `taken_at`, `location`, `distance_to_report_m`, `moderation`, `reviewed_by/at`                                                                                                                                                                                      | after-photo stores where and when it was taken                                                                                  |
| `report_events`        | `type`, `from_status`, `to_status`, `actor_id`, `data`                                                                                                                                                                                                                                                                                    | written only by the functions (`log_report_event`)                                                                              |
| `report_confirmations` | `report_id`, `user_id`                                                                                                                                                                                                                                                                                                                    | one confirmation per user                                                                                                       |
| `pickup_tasks`         | `report_id`, `tenant_id`, `location`, `bag_count`, `estimated_kg`, `photo_id`, `status` (open / collected / cancelled), `created_by`, `collected_by/at`                                                                                                                                                                                   | only where a municipality is responsible                                                                                        |

Categories: plastic, construction, electronics, mixed, bulky, hazardous, other. Hazard types
(category hazardous): batteries, chemicals, asbestos, needles, oil, other. Sizes: bag, pile,
container, truck (default kg 5 / 40 / 300 / 1500).

## How writes work: functions, not table grants

`anon` and `authenticated` have **no** `insert`/`update`/`delete` grants on the report tables.
Every change goes through a `security definer` function with an empty `search_path`, which checks
the caller and the rules, changes the rows and writes the history event in one transaction:

| Function                                                                          | Who                                                                                                                           | Checks                                                                                                                                           |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `submit_report`                                                                   | any session (anonymous counts)                                                                                                | rate limit per hour and user (`PT429` → HTTP 429); same `client_id` returns the same report (offline retries); tenant from location; kg estimate |
| `add_report_photo`                                                                | reporter                                                                                                                      | file must be in the caller's folder and exist (CS005); max 3 photos per kind (CS006)                                                             |
| `find_nearby_open_reports`                                                        | anyone                                                                                                                        | duplicate warning within `duplicate_radius_m`                                                                                                    |
| `confirm_report`                                                                  | registered users, not own report, once                                                                                        | reported → confirmed; publishes after `auto_approve_confirmations`                                                                               |
| `claim_report` / `unclaim_report`                                                 | `can_work_on_report`: staff, or registered volunteers/members if the tenant allows; **never hazardous for non-staff** (CS004) | one claimer at a time (CS003)                                                                                                                    |
| `submit_cleanup`                                                                  | as claim                                                                                                                      | after-photo location within `cleanup_radius_m` (default 50 m) of the report, else CS002; stores `taken_at` and distance                          |
| `report_bags` / `collect_pickup` / `cancel_pickup` / `open_pickup_tasks`          | clearer or staff / staff                                                                                                      | bags within `bag_drop_radius_m`, ≤ `max_bags_per_drop`; only in municipalities (CS010)                                                           |
| `moderate_photo`, `set_report_status`, `mark_duplicate`                           | tenant staff                                                                                                                  | approving a before-photo publishes the report                                                                                                    |
| `export_my_data`, `delete_my_photos`, `delete_my_account`, `leave_volunteer_role` | the user themselves                                                                                                           | DSGVO self-service (see below)                                                                                                                   |
| `expire_stale_claims`, `orphan_photo_paths`                                       | `service_role` only                                                                                                           | maintenance                                                                                                                                      |

Errors use custom SQLSTATE codes (`CS001`–`CS010`, `PT429`), which the app maps to translated
messages.

## How reads work: RLS and public views

- **Public data** comes from views that run with the owner's rights and expose only non-personal,
  published data: `reports_public` (location, category, status, counts; `comment` only when
  `is_published`; never reporter or claimer ids, only `reported_by_me` / `claimed_by_me` flags),
  `report_photos_public` (approved photos only), `report_events_public` (no actor ids),
  `public_profiles` (id + display name). Rejected and duplicate reports are not in them. The map
  uses `reports_in_bbox` (bounding box, status filter, limit), the landing page `public_stats`
  (aggregate numbers only, plain GET so it can be cached offline).
- **Tables** are readable only through RLS policies:

| Table                  | Select policy                                                      |
| ---------------------- | ------------------------------------------------------------------ |
| `tenants`              | everyone (names and areas are public)                              |
| `profiles`             | own row, super admins, staff of a tenant the person is a member of |
| `memberships`          | own memberships, staff of that tenant                              |
| `reports`              | reporter, claimer, staff of the report's tenant                    |
| `report_photos`        | uploader, staff of the report's tenant                             |
| `report_events`        | as the report                                                      |
| `report_confirmations` | own, staff of the report's tenant                                  |
| `pickup_tasks`         | creator, staff of the tenant                                       |

- **Writes allowed directly by policy:** `tenants` insert/delete (super admin), update (tenant
  admin; slug/kind/area super admin only via trigger); `profiles` update own row (privileged
  columns guarded by trigger); `memberships` insert by tenant admins, or **self-service join of
  the public tenant as volunteer** (registered, not blocked, not anonymous); delete own or by
  tenant admin.
- **Helpers used inside policies** (`is_super_admin`, `tenant_role`, `has_tenant_role`,
  `is_tenant_staff`, `is_tenant_admin`, `is_blocked`, `is_anonymous_user`) are `security definer`
  with an empty `search_path`, so policies cannot recurse into RLS and cannot be hijacked by a
  malicious `search_path`. Super admins count as staff and admin everywhere.

## Photos and privacy

- The client compresses every photo (max 1600 px, WebP), applies the EXIF orientation and
  **drops all metadata** (GPS, camera) before upload.
- Bucket `report-photos` is **private** (5 MB, WebP/JPEG only). Upload only into
  `<own uid>/…` (`report_photos_upload`, not when blocked). Read through `can_read_photo`: own
  files, approved photos of public reports, or staff of the report's tenant. The app requests
  short-lived signed URLs.
- **Photos stay hidden until reviewed** (`moderation = 'approved'`) or until the report is
  published by `auto_approve_confirmations` confirmations. Faces or licence plates: staff reject
  the photo; automated blurring is described in [docs/PHOTO_BLURRING.md](docs/PHOTO_BLURRING.md).
- Delete: `report_photos_delete_own` allows deleting own files only when no report references
  them (after `delete_my_photos`). Files never attached within 24 h are removed by the
  maintenance function **through the Storage API**.

## DSGVO

- No tracking, no analytics, no cookies (the session is in localStorage/IndexedDB); EU hosting.
- `export_my_data`: account, profile, memberships, reports by role, photos (7-day links),
  confirmations, events — as a JSON download (share sheet in the native app).
- `delete_my_account`: deletes photos (rows here, files through the Storage API from the app),
  removes comments from own reports, releases claims, deletes the auth user (cascade to profile
  and memberships). Reports stay as anonymous data because the waste is still there.
- Legal page templates (Impressum, Datenschutz, Nutzungsbedingungen) in
  `src/features/legal/content`, marked "must be reviewed by a lawyer".

## Offline and sync

- **Offline queue** (`src/features/report/outbox`): each report (draft + photo blobs) is stored in
  IndexedDB before the first attempt and sent on start, when back online, on visibility, on a
  backoff timer, and (Chromium/Android web) by the service worker through **Background Sync**.
  The device-generated `client_id` makes every retry idempotent. A Web Lock prevents two tabs
  from sending at once.
- **Service worker** (web only, not in the native apps): app shell precached, map style
  network-first, tiles/glyphs/sprites cache-first (3000 files, 30 days).

## Maintenance

`supabase/functions/maintenance` runs hourly (pg_cron + pg_net, URL and secret in Vault): releases
claims older than `claim_expiry_hours` and deletes orphan photo files. Claim expiry also runs as
a plain pg_cron job, so it works without Edge Functions.

## Testing

| Layer                                                      | Tool                           | Runs on                                                        |
| ---------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| Unit, components                                           | Vitest + React Testing Library | jsdom                                                          |
| Database: schema, RLS, functions                           | Vitest, `supabase/tests/lite`  | PGlite + PostGIS (default); real Supabase with `verify:remote` |
| API: PostgREST, Storage, Edge Function                     | Vitest, `tests/remote-api`     | real Supabase (`verify:remote`)                                |
| Main flows, offline, PWA, accessibility (axe, WCAG 2.1 AA) | Playwright                     | Chromium                                                       |

`verify:remote` runs on a dedicated, empty verify project; each DB test file runs in one
transaction that is rolled back; the API suite deletes what it created. The demo data lives in a
separate demo project. Results: [VERIFY_ON_SUPABASE.md](VERIFY_ON_SUPABASE.md).
