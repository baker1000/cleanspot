# Verify on real Supabase

Every RLS rule, grant and RPC below has so far been tested **only in PGlite** (`supabase/tests/lite/`), on a hand-written shim of Supabase's `auth` and `storage` schemas and API roles. Each one must be re-run against a real Supabase stack (local Docker or a cloud project in Frankfurt / eu-central-1) **before Milestone 1 is finished**.

**Status legend:** ⬜ PGlite only · ✅ verified on real Supabase · ❌ failed on real Supabase (see notes)

## How to verify

1. `npm run db:start` (Docker) or link a cloud project (`npx supabase link`), then `npm run db:reset`.
2. Run the planned pgTAP suite (`npm run db:test`). Its tests will be named like the PGlite tests listed below.
3. Run the API-level checks (marked **API**) with supabase-js against the running stack. These go through PostgREST/Storage, which PGlite cannot imitate.
4. Tick the boxes here and note the date and the stack (Docker version or cloud project ref).

## A. Shim assumptions (check these first)

If any of these is wrong, rows in B–D may be passing in PGlite for the wrong reason.

| #   | Assumption                                                                                                                      | How to check                                                         | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------ |
| A1  | `auth.uid()` reads the JWT `sub`; `auth.jwt() ->> 'is_anonymous'` is `true` for anonymous sign-ins                              | Sign in anonymously, `select auth.jwt()` via RPC                     | ⬜     |
| A2  | Views with `security_invoker = false`, owned by `postgres`, bypass RLS on base tables (owner bypass)                            | **API**: anon reads `reports_public` and gets rows                   | ⬜     |
| A3  | SECURITY DEFINER functions owned by `postgres` bypass RLS                                                                       | Covered by any RPC test passing                                      | ⬜     |
| A4  | Migrations can create policies on `storage.objects` and insert into `storage.buckets`                                           | `db reset` succeeds                                                  | ⬜     |
| A5  | Storage API upload is checked against the `storage.objects` INSERT policy, and download / signed URL against the SELECT policy  | **API**: upload into another user's folder fails                     | ⬜     |
| A6  | `storage.foldername(name)[1]` returns the first path segment                                                                    | **API**: upload to `<own uid>/x.webp` works                          | ⬜     |
| A7  | RAISE with SQLSTATE `PT429` becomes HTTP 429 in PostgREST; custom `CSxxx` codes reach the client in `error.code`                | **API**: call `submit_report` six times as anonymous                 | ⬜     |
| A8  | Supabase's default grants on new `public` objects are narrowed by our `revoke` statements (anon cannot `select * from reports`) | **API**: anon `from('reports').select()` returns an error            | ⬜     |
| A9  | `revoke execute … from public, anon` really hides internal helpers from the API                                                 | **API**: anon `rpc('attach_photo')` / `rpc('log_report_event')` fail | ⬜     |
| A10 | Anonymous sign-in rate limit (`config.toml`: 30/h per IP) is active                                                             | Cloud dashboard / local config                                       | ⬜     |

## B. Migration 1 — tenancy (`core_tenancy.test.ts`)

| #   | Rule / function                                                                      | PGlite test                                                | Status |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------ |
| B1  | `handle_new_user` trigger creates a profile for every auth user, incl. anonymous     | signup trigger › creates a profile…                        | ⬜     |
| B2  | `tenant_for_point`: smallest containing municipality, else public tenant             | tenant routing › (2 tests)                                 | ⬜     |
| B3  | `tenant_settings` merges stored settings over defaults                               | merges stored settings over defaults                       | ⬜     |
| B4  | `tenants_select`: anon + authenticated can read tenants                              | anon can list tenants                                      | ⬜     |
| B5  | `tenants_insert`: super admin only                                                   | anon and normal users cannot create tenants                | ⬜     |
| B6  | `tenants_update` + `guard_tenant_update`: admin edits own tenant, not slug/kind/area | tenant admin can rename own tenant but not change its area | ⬜     |
| B7  | `tenants_update`: no access to other tenants                                         | tenant admin cannot touch another tenant                   | ⬜     |
| B8  | Super admin can change area                                                          | super admin can change an area                             | ⬜     |
| B9  | `profiles_select`: own row only                                                      | users see only their own profile                           | ⬜     |
| B10 | `profiles_select`: staff see profiles of their tenant's members only                 | tenant staff see profiles of their members…                | ⬜     |
| B11 | anon cannot read `profiles`; `public_profiles` exposes id + display_name             | anon cannot read profiles…                                 | ⬜     |
| B12 | `profiles_update`: own display name                                                  | users can edit their display name                          | ⬜     |
| B13 | `guard_profile_update`: cannot set own `is_super_admin` / `blocked_until`            | users cannot make themselves super admin…                  | ⬜     |
| B14 | `profiles_update`: not someone else's profile                                        | users cannot edit someone else's profile                   | ⬜     |
| B15 | `memberships_insert`: self-join public tenant as volunteer                           | a registered user can join the public tenant…              | ⬜     |
| B16 | `memberships_insert`: no self-assigned staff role, no direct municipality join       | nobody can self-assign a staff role…                       | ⬜     |
| B17 | `memberships_insert`: anonymous users cannot join                                    | anonymous users cannot join as volunteer                   | ⬜     |
| B18 | `memberships_insert`: admin adds staff to own tenant only                            | tenant admin can add staff to own tenant only              | ⬜     |
| B19 | `memberships_update`: no self-promotion                                              | a volunteer cannot promote themselves                      | ⬜     |
| B20 | `memberships_delete`: leave / admin removes                                          | memberships delete › users can leave…                      | ⬜     |

## C. Migration 2 — reports (`reports.test.ts`)

### RPCs

| #   | RPC / rule                                                                                                 | PGlite test                                                 | Status |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| C1  | `submit_report`: anon role (no session) cannot execute                                                     | requires a session…                                         | ⬜     |
| C2  | `submit_report`: tenant routing, kg estimate, unpublished, `created` event, comment trimmed                | routes to the tenant, estimates kg…                         | ⬜     |
| C3  | `submit_report`: idempotent per `client_id`; other user cannot reuse it (CS007)                            | is idempotent per client_id…                                | ⬜     |
| C4  | `submit_report`: `hazard_type` only for `hazardous` (defaults to `other`)                                  | normalises hazard_type…                                     | ⬜     |
| C5  | `submit_report`: anonymous rate limit 5/h → PT429                                                          | rate-limits anonymous reporters                             | ⬜     |
| C6  | `submit_report`: blocked user → 42501; invalid coordinates → CS007                                         | rejects blocked users and invalid coordinates               | ⬜     |
| C7  | `submit_report`: registered rate limit 20/h                                                                | registered rate limit › applies reports_per_hour_registered | ⬜     |
| C8  | `add_report_photo`: object must exist in bucket, in the uploader's own folder (CS005)                      | attach requires an uploaded object…                         | ⬜     |
| C9  | `add_report_photo`: reporter or staff only (42501); max 3 per kind (CS006)                                 | attach requires an uploaded object…                         | ⬜     |
| C10 | `find_nearby_open_reports`: 30 m radius, open statuses only, distance returned                             | finds open reports within 30 m…                             | ⬜     |
| C11 | `confirm_report`: not by reporter / anonymous (CS008)                                                      | reporter and anonymous users cannot confirm                 | ⬜     |
| C12 | `confirm_report`: reported → confirmed; idempotent                                                         | first confirmation sets status confirmed…                   | ⬜     |
| C13 | `confirm_report` → `publish_report` after N confirmations: before-photos approved, comment public          | after N (=3) confirmations…                                 | ⬜     |
| C14 | `claim_report`: anonymous + non-volunteers rejected (42501)                                                | anonymous users and registered non-volunteers cannot claim  | ⬜     |
| C15 | `claim_report` / `unclaim_report`: claim, CS003 for others, unclaim restores status                        | a volunteer claims; others cannot…                          | ⬜     |
| C16 | `claim_report`: hazardous → staff of the report's tenant only (CS004)                                      | hazardous reports cannot be claimed by volunteers…          | ⬜     |
| C17 | `can_work_on_report`: `allow_volunteer_claims = false`                                                     | respects allow_volunteer_claims = false                     | ⬜     |
| C18 | `submit_cleanup`: > 50 m → CS002, status unchanged                                                         | rejects an after-photo taken more than 50 m away            | ⬜     |
| C19 | `submit_cleanup`: ≤ 50 m clears; stores distance, taken_at, cleared_by; implicit claim; photo pending      | clears within 50 m…                                         | ⬜     |
| C20 | `attach_photo`: staff photos auto-approved                                                                 | staff after-photos are auto-approved                        | ⬜     |
| C21 | `submit_cleanup`: claimed report → only claimer or staff (CS003)                                           | only the claimer (or staff)…                                | ⬜     |
| C22 | `submit_cleanup`: hazardous → volunteers rejected (CS004)                                                  | volunteers cannot clear hazardous reports                   | ⬜     |
| C23 | `submit_cleanup`: taken_at in the future or before the report → CS007                                      | rejects photo timestamps…                                   | ⬜     |
| C24 | `submit_cleanup`: already cleared → CS001                                                                  | cannot clear an already cleared report                      | ⬜     |
| C25 | `moderate_photo`: staff of the tenant only; approve before-photo publishes; rejected stays hidden          | staff review…                                               | ⬜     |
| C26 | `set_report_status`: staff of the tenant only; rejected hidden from public; reporter still sees it         | only staff of the tenant can change status…                 | ⬜     |
| C27 | `mark_duplicate`: links + hides; `set_report_status('duplicate')` refused; original may not be a duplicate | mark_duplicate links to the original…                       | ⬜     |
| C28 | Routing: report outside every municipality → public tenant                                                 | reports outside every municipality…                         | ⬜     |
| C29 | `reports_in_bbox`: bbox + status filter, callable by anon                                                  | reports_in_bbox returns reports in the box…                 | ⬜     |

### RLS / grants / views

| #   | Rule                                                                                 | PGlite test                                                   | Status |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------ |
| C30 | No direct INSERT/UPDATE on `reports` for authenticated                               | clients cannot write the reports table directly               | ⬜     |
| C31 | `reports_select`: anon denied; reporter, claimer, staff of tenant only               | base table: anon denied…                                      | ⬜     |
| C32 | `reports_public`: no `reporter_id`, comment hidden until published, `reported_by_me` | anon sees reports_public… / the reporter sees reported_by_me  | ⬜     |
| C33 | `report_events_select`: anon denied; `report_events_public` visible                  | public timeline is visible to anon…                           | ⬜     |
| C34 | `report_photos_public`: approved photos only                                         | after N confirmations… / staff review…                        | ⬜     |
| C35 | `report_photos_select`, `report_confirmations_select` (uploader / own / staff)       | remaining read rules › report_photos… / report_confirmations… | ⬜     |
| C36 | `claimed_by_me` in `reports_public`                                                  | remaining read rules › claimed_by_me…                         | ⬜     |

### Storage (`report-photos` bucket)

| #   | Rule                                                                                           | PGlite test                          | Status |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------ | ------ |
| C37 | `report_photos_upload`: own folder only                                                        | uploads only into the own folder     | ⬜     |
| C38 | `report_photos_upload`: blocked users cannot upload                                            | blocked users cannot upload          | ⬜     |
| C39 | `report_photos_read` / `can_read_photo`: pending photos unreadable for anon, approved readable | after N confirmations…               | ⬜     |
| C40 | Bucket limits: 5 MiB, `image/webp` + `image/jpeg` only                                         | **API only**, not testable in PGlite | ⬜     |

## D. Migration 3 — maintenance (`maintenance.test.ts`, `functions/_shared/maintenance.test.ts`)

| #   | Rule / function                                                                                                                                                 | PGlite / unit test                                                                 | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| D1  | `expire_stale_claims`: > 72 h released to reported/confirmed, ≤ 72 h kept, `unclaimed` event with reason `expired`                                              | expire_stale_claims › releases claims older than 72 h…                             | ⬜     |
| D2  | `expire_stale_claims`: per-tenant `claim_expiry_hours`                                                                                                          | uses the tenant claim_expiry_hours setting                                         | ⬜     |
| D3  | `expire_stale_claims`, `orphan_photo_paths`: service role only                                                                                                  | is not callable by API users (2 tests)                                             | ⬜     |
| D4  | `orphan_photo_paths`: old + unattached + bucket `report-photos` only                                                                                            | lists old unattached photos only                                                   | ⬜     |
| D5  | pg_cron job `cleanspot-expire-claims` is created by the migration (skipped in PGlite)                                                                           | **real stack only**: `select * from cron.job`                                      | ⬜     |
| D6  | `maintenance` Edge Function: 401 without / with wrong `x-maintenance-secret`; deletes orphan files through the Storage API (file really gone, not only the row) | unit tests cover logic only; **API**: call function, then try to download the file | ⬜     |
| D7  | pg_cron + pg_net schedule from `functions/maintenance/README.md` works with Vault secrets                                                                       | **real stack only**                                                                | ⬜     |
