# Release checklist

Items that **must** be done before a public release (Play Store production or a municipality pilot). Tick them off with date + commit.

## Blockers

- [ ] **Verify on real Supabase.** Every row in [VERIFY_ON_SUPABASE.md](VERIFY_ON_SUPABASE.md) is ✅ on Docker or a Supabase cloud project in the EU. The current test project is in West EU (Ireland, eu-west-1); for production, choose Central EU (Frankfurt, eu-central-1) if hosting in Germany is part of the offer to the Landkreis. Required before Milestone 1 is finished.
- [ ] **Auth URLs on the production project.** Set Authentication → URL Configuration → Site URL (and redirect URLs) to the real app URL; the test project still has the default `http://localhost:3000`.
- [ ] **Account deletion deletes the user's photos.** Deleting an account must remove every file the user uploaded (storage objects through the Storage API, not only rows), plus the `report_photos` rows. Today `reporter_id` / `uploaded_by` are only set to null.
- [ ] **Spatial index for the map query.** `reports_in_bbox` filters on computed lng/lat and does not use `reports_location_gix`. Rewrite it to use `location && ST_MakeEnvelope(...)` and check with `EXPLAIN` **before generating the pitch dataset**.
- [ ] **Maintenance job scheduled** in each environment (claim expiry runs via pg_cron automatically; orphan cleanup needs the setup in `supabase/functions/maintenance/README.md`).
- [ ] **Translations reviewed by native speakers** (ar, fr, tr, uk were written by the developer/AI; German uses the formal "Sie"). English should be proofread too.
- [ ] **Legal texts reviewed by a lawyer** (Impressum, Datenschutzerklärung, Nutzungsbedingungen).

## Product decisions already agreed (implement in the named step)

- [ ] Report flow: hazardous waste outside any municipality shows a "contact your local authority" text (Milestone 1, report flow).
- [ ] Offline queue: if attaching a photo fails with `CS005` (file was removed as an orphan), re-upload it from the local copy and retry (Milestone 1, offline queue).
