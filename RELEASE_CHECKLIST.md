# Release checklist

Items that **must** be done before a public release (Play Store production or a municipality pilot). Tick them off with date + commit.

## Blockers

- [x] **Verify on real Supabase.** Every row in [VERIFY_ON_SUPABASE.md](VERIFY_ON_SUPABASE.md) is ✅ (2026-10-04, cloud test project in West EU / Ireland, eu-west-1; 78 / 78). Re-run `npm run verify:remote` after every new migration.
- [ ] **Production project region and verification.** For production, choose Central EU (Frankfurt, eu-central-1) if hosting in Germany is part of the offer to the Landkreis, and run `npm run verify:remote` there once before seeding.
- [ ] **Auth URLs on the production project.** Set Authentication → URL Configuration → Site URL (and redirect URLs) to the real app URL; the test project still has the default `http://localhost:3000`.
- [ ] **Account deletion deletes the user's photos.** Deleting an account must remove every file the user uploaded (storage objects through the Storage API, not only rows), plus the `report_photos` rows. Today `reporter_id` / `uploaded_by` are only set to null.
- [x] **Spatial index for the map query.** Migration 5 (`reports_location_geom_gix`), verified on the cloud test project 2026-10-04 (F1–F3).
- [ ] **Maintenance job scheduled** in each environment: `npm run cloud:maintenance` (done on the cloud test project 2026-10-04, D7). Claim expiry also runs via pg_cron without it.
- [ ] **Native app identifies itself to Nominatim.** Browsers cannot set `User-Agent`, so the web app relies on the Referer. The Android build must pass an `HttpGet` based on CapacitorHttp that sets `User-Agent: CleanSpot/<version> (+<project URL>)` (`createGeocoder(env, http)`; Capacitor step).
- [ ] **Geocoder for a Landkreis rollout.** The public Nominatim server is fine for a pilot (search on submit, ≤ 1 request/1.1 s per device, cached). For heavy use, set `VITE_GEOCODER_URL` to a self-hosted Nominatim or another provider (`VITE_GEOCODER_PROVIDER`).
- [ ] **Translations reviewed by native speakers** (ar, fr, tr, uk were written by the developer/AI; German uses the formal "Sie"). English should be proofread too.
- [ ] **Legal texts reviewed by a lawyer** (Impressum, Datenschutzerklärung, Nutzungsbedingungen).

## Product decisions already agreed (implement in the named step)

- [ ] Report flow: hazardous waste outside any municipality shows a "contact your local authority" text (Milestone 1, report flow).
- [ ] Offline queue: if attaching a photo fails with `CS005` (file was removed as an orphan), re-upload it from the local copy and retry (Milestone 1, offline queue).
