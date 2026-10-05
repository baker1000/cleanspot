# Release checklist

Items that **must** be done before a public release (Play Store production or a municipality pilot). Tick them off with date + commit.

## Blockers

- [x] **Verify on real Supabase.** Every row in [VERIFY_ON_SUPABASE.md](VERIFY_ON_SUPABASE.md) is ✅ (2026-10-04, cloud test project in West EU / Ireland, eu-west-1; 78 / 78). Re-run `npm run verify:remote` after every new migration.
- [ ] **Production project region and verification.** For production, create a **separate** project in Central EU (Frankfurt, eu-central-1): not the verify project (Ireland, kept empty for `verify:remote`) and not the demo project (Frankfurt, demo data with public demo logins). Give it its own env file and target (`scripts/cloud-target.mjs`) and run the DB + API suites there once while it is still empty.
- [ ] **Auth URLs on the production project.** Set Authentication → URL Configuration → Site URL (and redirect URLs) to the real app URL; the test project still has the default `http://localhost:3000`.
- [x] **Account deletion deletes the user's photos.** Rows via `delete_my_photos`, files through the Storage API from the app, leftovers by the hourly orphan cleanup (step 9; on the cloud: API F8, F10, 2026-10-05).
- [x] **Spatial index for the map query.** Migration 5 (`reports_location_geom_gix`), verified on the cloud test project 2026-10-04 (F1–F3).
- [ ] **Maintenance job scheduled** in each environment: `npm run cloud:maintenance` / `npm run demo:maintenance` (verify project 2026-10-04, D7; demo project 2026-10-05, test call 200/401). Production: still to do. Claim expiry also runs via pg_cron without it.
- [ ] **Native app identifies itself to Nominatim.** Browsers cannot set `User-Agent`, so the web app relies on the Referer. Partly done: the native WebView appends `CleanSpot-App` to its User-Agent (`capacitor.config.ts`), but the Referer is `https://localhost` and there is no contact URL. Still to do: an `HttpGet` based on CapacitorHttp that sets `User-Agent: CleanSpot/<version> (+<project URL>)` (`createGeocoder(env, http)`), or a self-hosted geocoder.
- [ ] **Geocoder for a Landkreis rollout.** The public Nominatim server is fine for a pilot (search on submit, ≤ 1 request/1.1 s per device, cached). For heavy use, set `VITE_GEOCODER_URL` to a self-hosted Nominatim or another provider (`VITE_GEOCODER_PROVIDER`).
- [ ] **Translations reviewed by native speakers** (ar, fr, tr, uk were written by the developer/AI; German uses the formal "Sie"). English should be proofread too.
- [ ] **Legal texts reviewed by a lawyer** (Impressum, Datenschutzerklärung, Nutzungsbedingungen).
- [ ] **Never ship a demo-mode build.** Production builds (web and Android) must have `VITE_DEMO_MODE=false` and no `VITE_DEMO_PASSWORD`: `npm run cloud:frontend-env -- --force` against the production project before `npm run build` / `npm run android:aab`.
- [ ] **Self-hosting tested once end to end** (`deploy/docker/README.md`, "Check the installation") before offering it to a municipality.
- [ ] **Google Play:** listing texts in en/ar read by native speakers, Data Safety form filled in from PLAY_STORE.md, closed test with 12+ testers for 14 days.

## Product decisions already agreed (implement in the named step)

- [x] Report flow: hazardous waste outside any municipality shows a "contact your local authority" text (Milestone 1, report flow). 2026-10-04, 4381459.
- [x] Offline queue: if attaching a photo fails with `CS005` (file was removed as an orphan), re-upload it from the local copy and retry (Milestone 1, offline queue). 2026-10-04, step 6.
