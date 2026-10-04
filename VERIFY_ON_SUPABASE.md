# Verify on real Supabase

Every RLS rule, grant and RPC below has so far been tested **only in PGlite** (`supabase/tests/lite/`), on a hand-written shim of Supabase's `auth` and `storage` schemas and API roles. Each one must be re-run against a real Supabase stack (local Docker or a Supabase cloud project in the EU; the current test project is in West EU / Ireland, eu-west-1) **before Milestone 1 is finished**.

**Status legend:** ⬜ PGlite only · ✅ verified on real Supabase · ⏸ blocked, not yet run (see run log) · ❌ failed on real Supabase (see notes)

## How to verify

1. Fill in `.env.supabase-cloud` (template: `supabase-cloud.env.example`), then `npm run cloud:link` and `npm run cloud:push` (row A4).
2. `npm run cloud:maintenance` (needed for D6).
3. `npm run verify:remote` runs:
   - **B, C, D (SQL level):** the same test files as PGlite, against the real database, as the real `anon` / `authenticated` / `service_role` roles with JWT claims set like PostgREST does. Everything runs in one transaction per file and is rolled back.
   - **Rows marked API:** `tests/remote-api/api.test.ts` through PostgREST, Storage and the Edge Function with real sessions.
4. Rows marked **manual** are checked in the dashboard.
5. Tick the boxes and note the date + project ref (the ref is not secret).

## Run log

### 2026-10-05 (eighth run) — migration 7: bag pickup (step 8), same project

- **Migration 7** (`20261005000007_bag_pickup.sql`) pushed; local = remote for all seven.
- `verify:remote`: **101 / 101 passed** — the new DB suite `pickups.test.ts` (G1–G9 below, run inside a rolled-back transaction on the cloud database) and API test **F7** (volunteer reports bags through the detail API: ~400 m refused with CS002 and the distance, ~130 m accepted, kg estimate 3 × 6; staff list the stop through `open_pickup_tasks` with a working signed photo URL; the volunteer cannot; collect works once; timeline `bags_reported`, `bags_collected`).
- Before the run: demo reports and 1 own test submission removed (`cloud:demo -- remove`, `remove-test`); demo reports seeded again afterwards.

### 2026-10-05 (seventh run) — report detail page (step 7), same project

- No new migration. `verify:remote`: **89 / 89 passed**, including the new API tests **F5** (the detail page reads a report through the public views like the app: reporter sees own photo under review with a working signed URL, visitor sees none; after approval the signed URL serves the file; timeline) and **F6** (a registered user joins the public tenant as volunteer, claims, a second volunteer cannot take over, the after-photo ~65 m away is refused with CS002 and the measured distance, ~7 m away clears the report).
- Demo reports removed before and seeded again after the run.

### 2026-10-04 (sixth run) — offline queue (step 6), same project

- No new migration. `verify:remote`: **87 / 87 passed**; F4 now also sends `p_taken_at` (as the offline queue does) and checks the stored photo time.
- Demo reports removed before and seeded again after the run.

### 2026-10-04 (fifth run) — migration 6, same project

- **Migration 6** (`20261004000006_tenant_at_point.sql`) pushed; local = remote for all six.
- Before the run: demo reports removed and 2 own test submissions from the report form deleted with `npm run cloud:demo -- remove-test` (their photo files are left to the hourly orphan cleanup, D7).
- `verify:remote`: **87 / 87 passed**, including the new API tests **F3** (anon calls `tenant_at_point` like the report form) and **F4** (the app's submit pipeline end to end for an anonymous user, retry returns the same report).
- Afterwards: 15 demo reports seeded again with `npm run cloud:demo -- seed`.

### 2026-10-04 (fourth run) — migration 5, same project

- **Migration 5** (`20261004000005_bbox_index.sql`) pushed; local = remote for all five.
- `verify:remote`: **82 / 82 passed**: the 3 new SQL tests (category filter, exact rectangle, index used) and a new API test where anon calls `reports_in_bbox` through PostgREST with the same arguments as the map (comment hidden, category filter works). F1–F3 ✅.
- Afterwards: 1 tenant (`public`), 0 users, 0 reports, 0 storage objects.

### 2026-10-04 (third run) — D7, same project

- `npm run cloud:maintenance` now also stores `maintenance_url` and `maintenance_secret` in Vault, enables pg_net and schedules `cleanspot-maintenance` (`17 * * * *`, 30 s HTTP timeout).
- New API test **D7** runs the exact command stored in `cron.job`; pg_net called the function with the Vault secrets, got HTTP 200, and an orphan file older than 24 h was deleted from Storage. **`verify:remote`: 78 / 78 passed.**
- `cron.job_run_details`: `cleanspot-expire-claims` ran on schedule at 10:07 local time and succeeded (pg_cron itself fires jobs; supports D5).
- Afterwards: 1 tenant (`public`), 0 users, 0 reports, 0 storage objects.

### 2026-10-04 (second run) — same project

- `cloud:auth-config` before the run: `external_anonymous_users_enabled = true`.
- **Migration 4** (`20261004000004_public_tenant.sql`) pushed; `cloud:migrations` shows local = remote for all four. The public tenant now exists on the project.
- **`npm run verify:remote`: 77 / 77 passed** (5 files): 64 SQL-level tests, 2 public-tenant tests and 11 API tests through PostgREST, Storage and the Edge Function. A1, A2, A5–A9, C40 and D6 are now ✅.
- Afterwards the project held only the `public` tenant: 0 auth users, 0 reports, 0 objects in `report-photos`.
- Still open after this run: D7 (done in the third run).

### 2026-10-04 — cloud project `hpzjyntdzmpdhutqvmgq` (West EU / Ireland, eu-west-1)

- **Migrations 1–3** applied with `npm run cloud:push`; `cloud:migrations` shows local = remote for all three (A4). PostGIS 3.3.7, pg_cron 1.6.4.
- **`maintenance` Edge Function** deployed with `npm run cloud:maintenance`; secret set. Not yet called (D6 is in the blocked API suite).
- **SQL-level suites** (`core_tenancy`, `reports`, `maintenance` test files, run with `npm run verify:remote`): **64 / 64 passed** against the real database, as the real `anon` / `authenticated` / `service_role` roles. This covers B1–B20, C1–C39 at SQL level, D1–D4 and A3.
  - Caveat: these suites set `request.jwt.claims` themselves, as PostgREST does. Whether the real Auth server puts `is_anonymous` into the JWT (A1) is only proven by the API suite.
- **D5**: `cron.job` contains `cleanspot-expire-claims`, schedule `7 * * * *`, command `select public.expire_stale_claims()`.
- **A10**: read via the Management API (`npm run cloud:auth-config`): `rate_limit_anonymous_users = 30` (per hour, per IP).
- **API suite (`tests/remote-api/api.test.ts`): blocked, 11 tests not run.** Setup failed with `Anonymous sign-ins are disabled`; the Management API confirms `external_anonymous_users_enabled = false` on the server. A1, A2, A5–A9, C40 and D6 stay ⏸ until anonymous sign-ins are enabled and the suite is re-run. No test data was left behind (0 `verify-*` tenants, 0 `verify-*` users, 0 reports checked afterwards).
- **Gap found: no public tenant on a fresh install.** No migration created the public tenant (the tests created it themselves), so on a fresh project `submit_report` fails with CS007 everywhere outside a municipality. Fixed by `20261004000004_public_tenant.sql` plus `public_tenant.test.ts` (passes in PGlite). Pushed in the second run (below).
- Also noticed: the project's Auth `site_url` is `http://localhost:3000`, not the app URL. It doesn't affect these tests, but must be set before any email or OAuth redirect is used.

## A. Shim assumptions (check these first)

If any of these is wrong, rows in B–D may be passing in PGlite for the wrong reason.

| #   | Assumption                                                                                                                      | How to check                                                         | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------ |
| A1  | `auth.uid()` reads the JWT `sub`; `auth.jwt() ->> 'is_anonymous'` is `true` for anonymous sign-ins                              | Sign in anonymously, `select auth.jwt()` via RPC                     | ✅     |
| A2  | Views with `security_invoker = false`, owned by `postgres`, bypass RLS on base tables (owner bypass)                            | **API**: anon reads `reports_public` and gets rows                   | ✅     |
| A3  | SECURITY DEFINER functions owned by `postgres` bypass RLS                                                                       | Covered by any RPC test passing                                      | ✅     |
| A4  | Migrations can create policies on `storage.objects` and insert into `storage.buckets`                                           | `db reset` succeeds                                                  | ✅     |
| A5  | Storage API upload is checked against the `storage.objects` INSERT policy, and download / signed URL against the SELECT policy  | **API**: upload into another user's folder fails                     | ✅     |
| A6  | `storage.foldername(name)[1]` returns the first path segment                                                                    | **API**: upload to `<own uid>/x.webp` works                          | ✅     |
| A7  | RAISE with SQLSTATE `PT429` becomes HTTP 429 in PostgREST; custom `CSxxx` codes reach the client in `error.code`                | **API**: call `submit_report` six times as anonymous                 | ✅     |
| A8  | Supabase's default grants on new `public` objects are narrowed by our `revoke` statements (anon cannot `select * from reports`) | **API**: anon `from('reports').select()` returns an error            | ✅     |
| A9  | `revoke execute … from public, anon` really hides internal helpers from the API                                                 | **API**: anon `rpc('attach_photo')` / `rpc('log_report_event')` fail | ✅     |
| A10 | **manual**: anonymous sign-in rate limit is active (Authentication → Rate Limits; `config.toml` only applies locally)           | Cloud dashboard / local config                                       | ✅     |

## B. Migration 1 — tenancy (`core_tenancy.test.ts`)

| #   | Rule / function                                                                      | PGlite test                                                | Status |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------ |
| B1  | `handle_new_user` trigger creates a profile for every auth user, incl. anonymous     | signup trigger › creates a profile…                        | ✅     |
| B2  | `tenant_for_point`: smallest containing municipality, else public tenant             | tenant routing › (2 tests)                                 | ✅     |
| B3  | `tenant_settings` merges stored settings over defaults                               | merges stored settings over defaults                       | ✅     |
| B4  | `tenants_select`: anon + authenticated can read tenants                              | anon can list tenants                                      | ✅     |
| B5  | `tenants_insert`: super admin only                                                   | anon and normal users cannot create tenants                | ✅     |
| B6  | `tenants_update` + `guard_tenant_update`: admin edits own tenant, not slug/kind/area | tenant admin can rename own tenant but not change its area | ✅     |
| B7  | `tenants_update`: no access to other tenants                                         | tenant admin cannot touch another tenant                   | ✅     |
| B8  | Super admin can change area                                                          | super admin can change an area                             | ✅     |
| B9  | `profiles_select`: own row only                                                      | users see only their own profile                           | ✅     |
| B10 | `profiles_select`: staff see profiles of their tenant's members only                 | tenant staff see profiles of their members…                | ✅     |
| B11 | anon cannot read `profiles`; `public_profiles` exposes id + display_name             | anon cannot read profiles…                                 | ✅     |
| B12 | `profiles_update`: own display name                                                  | users can edit their display name                          | ✅     |
| B13 | `guard_profile_update`: cannot set own `is_super_admin` / `blocked_until`            | users cannot make themselves super admin…                  | ✅     |
| B14 | `profiles_update`: not someone else's profile                                        | users cannot edit someone else's profile                   | ✅     |
| B15 | `memberships_insert`: self-join public tenant as volunteer                           | a registered user can join the public tenant…              | ✅     |
| B16 | `memberships_insert`: no self-assigned staff role, no direct municipality join       | nobody can self-assign a staff role…                       | ✅     |
| B17 | `memberships_insert`: anonymous users cannot join                                    | anonymous users cannot join as volunteer                   | ✅     |
| B18 | `memberships_insert`: admin adds staff to own tenant only                            | tenant admin can add staff to own tenant only              | ✅     |
| B19 | `memberships_update`: no self-promotion                                              | a volunteer cannot promote themselves                      | ✅     |
| B20 | `memberships_delete`: leave / admin removes                                          | memberships delete › users can leave…                      | ✅     |

## C. Migration 2 — reports (`reports.test.ts`)

### RPCs

| #   | RPC / rule                                                                                                 | PGlite test                                                 | Status |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| C1  | `submit_report`: anon role (no session) cannot execute                                                     | requires a session…                                         | ✅     |
| C2  | `submit_report`: tenant routing, kg estimate, unpublished, `created` event, comment trimmed                | routes to the tenant, estimates kg…                         | ✅     |
| C3  | `submit_report`: idempotent per `client_id`; other user cannot reuse it (CS007)                            | is idempotent per client_id…                                | ✅     |
| C4  | `submit_report`: `hazard_type` only for `hazardous` (defaults to `other`)                                  | normalises hazard_type…                                     | ✅     |
| C5  | `submit_report`: anonymous rate limit 5/h → PT429                                                          | rate-limits anonymous reporters                             | ✅     |
| C6  | `submit_report`: blocked user → 42501; invalid coordinates → CS007                                         | rejects blocked users and invalid coordinates               | ✅     |
| C7  | `submit_report`: registered rate limit 20/h                                                                | registered rate limit › applies reports_per_hour_registered | ✅     |
| C8  | `add_report_photo`: object must exist in bucket, in the uploader's own folder (CS005)                      | attach requires an uploaded object…                         | ✅     |
| C9  | `add_report_photo`: reporter or staff only (42501); max 3 per kind (CS006)                                 | attach requires an uploaded object…                         | ✅     |
| C10 | `find_nearby_open_reports`: 30 m radius, open statuses only, distance returned                             | finds open reports within 30 m…                             | ✅     |
| C11 | `confirm_report`: not by reporter / anonymous (CS008)                                                      | reporter and anonymous users cannot confirm                 | ✅     |
| C12 | `confirm_report`: reported → confirmed; idempotent                                                         | first confirmation sets status confirmed…                   | ✅     |
| C13 | `confirm_report` → `publish_report` after N confirmations: before-photos approved, comment public          | after N (=3) confirmations…                                 | ✅     |
| C14 | `claim_report`: anonymous + non-volunteers rejected (42501)                                                | anonymous users and registered non-volunteers cannot claim  | ✅     |
| C15 | `claim_report` / `unclaim_report`: claim, CS003 for others, unclaim restores status                        | a volunteer claims; others cannot…                          | ✅     |
| C16 | `claim_report`: hazardous → staff of the report's tenant only (CS004)                                      | hazardous reports cannot be claimed by volunteers…          | ✅     |
| C17 | `can_work_on_report`: `allow_volunteer_claims = false`                                                     | respects allow_volunteer_claims = false                     | ✅     |
| C18 | `submit_cleanup`: > 50 m → CS002, status unchanged                                                         | rejects an after-photo taken more than 50 m away            | ✅     |
| C19 | `submit_cleanup`: ≤ 50 m clears; stores distance, taken_at, cleared_by; implicit claim; photo pending      | clears within 50 m…                                         | ✅     |
| C20 | `attach_photo`: staff photos auto-approved                                                                 | staff after-photos are auto-approved                        | ✅     |
| C21 | `submit_cleanup`: claimed report → only claimer or staff (CS003)                                           | only the claimer (or staff)…                                | ✅     |
| C22 | `submit_cleanup`: hazardous → volunteers rejected (CS004)                                                  | volunteers cannot clear hazardous reports                   | ✅     |
| C23 | `submit_cleanup`: taken_at in the future or before the report → CS007                                      | rejects photo timestamps…                                   | ✅     |
| C24 | `submit_cleanup`: already cleared → CS001                                                                  | cannot clear an already cleared report                      | ✅     |
| C25 | `moderate_photo`: staff of the tenant only; approve before-photo publishes; rejected stays hidden          | staff review…                                               | ✅     |
| C26 | `set_report_status`: staff of the tenant only; rejected hidden from public; reporter still sees it         | only staff of the tenant can change status…                 | ✅     |
| C27 | `mark_duplicate`: links + hides; `set_report_status('duplicate')` refused; original may not be a duplicate | mark_duplicate links to the original…                       | ✅     |
| C28 | Routing: report outside every municipality → public tenant                                                 | reports outside every municipality…                         | ✅     |
| C29 | `reports_in_bbox`: bbox + status filter, callable by anon                                                  | reports_in_bbox returns reports in the box…                 | ✅     |

### RLS / grants / views

| #   | Rule                                                                                 | PGlite test                                                   | Status |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------ |
| C30 | No direct INSERT/UPDATE on `reports` for authenticated                               | clients cannot write the reports table directly               | ✅     |
| C31 | `reports_select`: anon denied; reporter, claimer, staff of tenant only               | base table: anon denied…                                      | ✅     |
| C32 | `reports_public`: no `reporter_id`, comment hidden until published, `reported_by_me` | anon sees reports_public… / the reporter sees reported_by_me  | ✅     |
| C33 | `report_events_select`: anon denied; `report_events_public` visible                  | public timeline is visible to anon…                           | ✅     |
| C34 | `report_photos_public`: approved photos only                                         | after N confirmations… / staff review…                        | ✅     |
| C35 | `report_photos_select`, `report_confirmations_select` (uploader / own / staff)       | remaining read rules › report_photos… / report_confirmations… | ✅     |
| C36 | `claimed_by_me` in `reports_public`                                                  | remaining read rules › claimed_by_me…                         | ✅     |

### Storage (`report-photos` bucket)

| #   | Rule                                                                                           | PGlite test                          | Status |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------ | ------ |
| C37 | `report_photos_upload`: own folder only                                                        | uploads only into the own folder     | ✅     |
| C38 | `report_photos_upload`: blocked users cannot upload                                            | blocked users cannot upload          | ✅     |
| C39 | `report_photos_read` / `can_read_photo`: pending photos unreadable for anon, approved readable | after N confirmations…               | ✅     |
| C40 | Bucket limits: 5 MiB, `image/webp` + `image/jpeg` only                                         | **API only**, not testable in PGlite | ✅     |

## D. Migration 3 — maintenance (`maintenance.test.ts`, `functions/_shared/maintenance.test.ts`)

| #   | Rule / function                                                                                                                                                 | PGlite / unit test                                                                 | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| D1  | `expire_stale_claims`: > 72 h released to reported/confirmed, ≤ 72 h kept, `unclaimed` event with reason `expired`                                              | expire_stale_claims › releases claims older than 72 h…                             | ✅     |
| D2  | `expire_stale_claims`: per-tenant `claim_expiry_hours`                                                                                                          | uses the tenant claim_expiry_hours setting                                         | ✅     |
| D3  | `expire_stale_claims`, `orphan_photo_paths`: service role only                                                                                                  | is not callable by API users (2 tests)                                             | ✅     |
| D4  | `orphan_photo_paths`: old + unattached + bucket `report-photos` only                                                                                            | lists old unattached photos only                                                   | ✅     |
| D5  | pg_cron job `cleanspot-expire-claims` is created by the migration (skipped in PGlite)                                                                           | **real stack only**: `select * from cron.job`                                      | ✅     |
| D6  | `maintenance` Edge Function: 401 without / with wrong `x-maintenance-secret`; deletes orphan files through the Storage API (file really gone, not only the row) | unit tests cover logic only; **API**: call function, then try to download the file | ✅     |
| D7  | pg_cron + pg_net schedule from `functions/maintenance/README.md` works with Vault secrets                                                                       | **real stack only**                                                                | ✅     |

## E. Migration 4 — public tenant (`public_tenant.test.ts`)

| #   | Rule / function                                                                        | PGlite test                             | Status |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------- | ------ |
| E1  | Migrations create exactly one public tenant; points outside municipalities route to it | public tenant (migration 4) › (2 tests) | ✅     |

## F. Migration 5 — map bbox query (`reports.test.ts`)

| #   | Rule / function                                                                                 | PGlite test                                         | Status |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| F1  | `reports_in_bbox` (security definer) is callable by anon and returns only `reports_public` rows | reports_in_bbox returns reports in the box…         | ✅     |
| F2  | `p_categories` filter; exact lng/lat rectangle with inclusive edges, also for wide viewports    | filters by category / is an exact lng/lat rectangle | ✅     |
| F3  | The bbox predicate uses `reports_location_geom_gix`                                             | the bbox filter … can use the spatial index         | ✅     |

## G. Migration 7 — bag pickup (`pickups.test.ts`)

| #   | Rule / function                                                                                                 | PGlite test                                           | Status |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| G1  | `report_bags`: task with bags photo (pending), kg = bags × `kg_per_bag`, report kg from bags, `bags_reported`   | creates a pickup task with photo, kg estimate…        | ✅     |
| G2  | `report_bags`: several drops add up (`refresh_report_kg`)                                                       | several drops add up                                  | ✅     |
| G3  | `report_bags`: cleared reports only (CS001)                                                                     | only for cleared reports                              | ✅     |
| G4  | `report_bags`: the person who cleared it or staff (42501); anon role cannot execute                             | only the person who cleared it… / anonymous visitors… | ✅     |
| G5  | `report_bags`: public tenant → CS010; bag count 1..`max_bags_per_drop` (CS007); `bag_drop_radius_m` 300 (CS002) | no pickup service… / validates the number of bags…    | ✅     |
| G6  | `pickup_tasks_select`: creator + staff of the tenant; others and anon none; no direct writes                    | RLS: the creator and the tenant staff see a task…     | ✅     |
| G7  | `open_pickup_tasks`: staff of the tenant only (42501), returns lng/lat and photo path                           | open_pickup_tasks: staff of the tenant only…          | ✅     |
| G8  | `collect_pickup`: staff only, once (CS001), `bags_collected` event, leaves the open list, kg still counted      | collect_pickup: staff only, once…                     | ✅     |
| G9  | `cancel_pickup`: creator while open or staff; kg falls back to the size estimate                                | cancel_pickup: the creator while open, or staff…      | ✅     |
