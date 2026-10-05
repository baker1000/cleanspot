# CleanSpot — Roadmap

Working plan derived from `CLAUDE.md` (the full spec). Mark a step `[x]` when it is finished and
tested; note anything left open under it. Steps 1–4 (data model, database + RLS, app shell + i18n,
map screen) were done before this file existed; see `git log`.

## Milestone 1 (MVP)

- [x] **5. Report flow** — 1–3 photos (compressed, EXIF stripped, WebP), auto GPS with editable pin,
      category, size, hazard type, optional comment with "no personal data" hint, duplicate warning
      within 30 m, anonymous submit. Verified on Supabase cloud (F3/F4).
- [x] **6. Offline queue** — every report is saved in IndexedDB (draft + photo blobs) before the
      first attempt; sent on app start, when the device comes back online, when the app becomes
      visible, on "Send now", and on a backoff timer (30 s doubling to 30 min; 15 min after a rate
      limit). Same `client_id` on every retry; one anonymous user for all queued reports; Web Lock
      so two tabs never send at once; photo re-uploaded from the local copy on `CS005`; photo keeps
      the original time (`p_taken_at`). Reports the server refuses go back to the form, or (from
      the background) are listed with "Discard". Tested: unit, PGlite, e2e in Chromium (offline →
      reload → sent), verify:remote 87/87.
      Known limits: sends only while the app is open (Background Sync: step 10); queued reports
      are not shown on the map; without IndexedDB there is no queue (sent directly, errors shown
      as before).
- [x] **7. Report detail page** — photos (approved ones; own photos under review marked as such),
      history timeline, estimated kg, responsible authority; actions: confirm (registered, not own
      report), navigate (OpenStreetMap route + geo: link), join as volunteer (explicit opt-in to the
      public tenant), "I'll clear this" / give back, after-photo with the location of that moment:
      distance shown before sending, server enforces the tenant radius (default 50 m) and stores
      the timestamp. Hazardous reports: no claim for volunteers. All 6 languages. Tested: unit,
      component, e2e in Chromium incl. axe (de + ar/RTL), verify:remote F5/F6 (89/89).
      Known limits: the after-photo needs a connection (not queued offline); a browser cannot
      prove the photo came from the camera, so the location is what is verified (native camera
      in step 11); no small map on the page (coordinates + route links); staff actions
      (moderation, status, assign) are Milestone 2; leaving the volunteer role → step 9.
- [x] **8. Bag pickup + pickup route** — migration 7 (`pickup_tasks`, `report_bags`,
      `collect_pickup`, `cancel_pickup`, `open_pickup_tasks`; RLS: creator + tenant staff). After
      clearing, the volunteer reports "X bags placed here" on the detail page with a photo and the
      location of the bags (within 300 m of the report, max 30 bags, configurable per tenant); the
      report's kg estimate then comes from the bags (6 kg each). Only where a municipality is
      responsible (CS010 in the public area; the app says so). Staff page `/app/pickups` (linked on
      the profile page for staff): open stops ordered into a route (nearest neighbour from every
      first stop + 2-opt + Or-opt, straight-line distances; optional start at the staff's
      location), summary of stops/bags/kg/km, navigation per stop, "Collected" / "Not there",
      whole route on routing.openstreetmap.de (FOSSGIS, OSM). Tested: PGlite + cloud DB suite
      (pickups.test.ts), route heuristic within 5 % of the optimum, page/API unit tests, e2e incl.
      axe (de + ar), verify:remote F7 (101/101).
      Known limits: route order uses straight-line distances (the router plans the roads, and
      may cap the number of stops in one link); no depot setting yet (start = staff location or
      free); bags photo is not queued offline; volunteers are not notified when bags are collected
      (notifications: Milestone 2).
- [x] **9. Profile + DSGVO** — migration 8 (`export_my_data`, `delete_my_photos`,
      `delete_my_account`, `leave_volunteer_role`; storage policy: delete own files no report
      references). Profile page: "Download my data" (JSON with 7-day photo links), "Delete account"
      (registered and anonymous; checkbox confirmation; photos and comments deleted, reports stay
      without reporter, claims released, unsent reports on the device discarded, local sign-out),
      "Stop volunteering" (releases claims except where the user is staff). Legal pages
      `/impressum`, `/datenschutz`, `/nutzungsbedingungen` (aliases `/imprint`, `/privacy`,
      `/terms`) from editable Markdown templates in `src/features/legal/content` (de binding +
      en), placeholders highlighted, "must be reviewed by a lawyer" notice until
      `LEGAL_TEXTS_REVIEWED` is set; linked from landing and profile. All 6 languages. Tested:
      PGlite (privacy.test.ts), unit/component, e2e incl. download and axe (de + ar), cloud API F8.
      Known limits: DB suite H1–H6 not yet run on the cloud (project not empty, see
      VERIFY_ON_SUPABASE.md); legal texts exist in German and English only (other languages show
      the English text with a note); files the app could not delete are removed by the hourly
      maintenance only after 24 h, and not at all without the maintenance function; if the
      sign-out request fails after deletion, the stale session stays in local storage until the
      next sign-in attempt; the download uses the browser (Capacitor file save/share → step 11);
      the privacy policy must be adapted to the real operator and services before publication.
- [x] **10. PWA** — vite-plugin-pwa (injectManifest, `src/sw/sw.ts`): manifest (name, icons
      192/512 + maskable, shortcut "Müll melden"), app shell and all chunks precached (opens
      offline), map style/TileJSON network-first and tiles/glyphs/sprites cache-first (3000 files,
      30 days, purged on quota errors), "new version" prompt instead of an automatic reload, offline
      notice in the app. Background Sync (Chromium/Android): the page registers a sync while
      reports wait; an open page is asked to send, otherwise the service worker sends the queue
      itself with the session mirrored into IndexedDB (same outbox lock, same idempotent submit),
      and the next page start says how many were sent. Landing page rebuilt: live statistics
      (migration 9 `public_stats`, plain GET, cached for offline), "how it works", for
      municipalities, install button (when the browser offers it), Google Play link from
      `VITE_PLAY_STORE_URL` (else "coming soon"). All 6 languages. Tested: unit/component, PGlite
      (public_stats.test.ts), e2e with the service worker enabled (manifest + icons, offline start,
      style and tile served from cache, statistics offline, Background Sync with no app page open
      via DevTools), cloud API F9.
      Known limits: Background Sync only in Chromium-based browsers (Firefox/Safari send when the
      app is next open); the browser decides when the sync fires and gives up after a few tries;
      tiles are cached only from the map style's own host (another style with tiles elsewhere is
      not cached offline); no explicit "download this area" (only viewed areas, oldest dropped
      first); reports on the map are not available offline (only the map itself); if a page and
      the service worker refresh the session at the same moment, Supabase's refresh-token reuse
      window (10 s) must cover it; the PNG icons are rendered with Playwright (`npm run icons`);
      the Google Play link uses text, not Google's official badge; Capacitor (step 11) must decide
      whether the native app uses the service worker; DB suite I1 not yet run on the cloud.
- [x] **11. Capacitor + Android build** — Capacitor 8 (`store.thinktools.cleanspot`), plugins camera,
      geolocation, filesystem, share, splash screen, app (all MIT). `src/lib/native.ts`: system
      camera for "Take photo" (report, after-photo, bags), Geolocation plugin with permission
      dialog, data export via the share sheet, splash hidden after the first render, Android back
      button; the native app opens on the map and does not register the service worker. Android:
      permissions INTERNET, CAMERA, location only (camera/GPS hardware optional), no app-data
      backup (DSGVO), targetSdk 36 / minSdk 24, version from `package.json` (0.1.0 → code 100),
      release signing from git-ignored `keystore.properties` (`npm run android:keystore`; upload
      key created), adaptive icon + round + legacy icons and Android 12+ splash rendered by
      `npm run icons`, safe areas for edge-to-edge (header padding, status-bar strip).
      `npm run android:apk` / `android:aab` build a debug APK and a signed release AAB (signature
      verified). iOS platform added (SPM) with Info.plist permission texts (de) and InfoPlist.strings
      in 6 languages, icon and splash; not built (needs a Mac): IOS_LATER.md. Found and fixed on
      the emulator: content under the status bar; the location line was always German in other
      languages (`lng` interpolation variable switched i18next's language; since step 5).
      Tested: unit (native branches with mocked plugins, i18n regression), e2e 56/56, Android 17
      emulator (API 37 image): app starts, landing redirects to the map, OpenFreeMap tiles and
      cloud reports load, camera permission + system camera + photo back in the form, location
      permission + position.
      Known limits: not tested on a real phone yet; a report was not sent from the emulator (it
      would create data in the cloud project); RTL and the share sheet export not checked on the
      emulator; no Background Sync in the native app (sent while open, as on iOS); Android 12+
      shows the icon on the system splash only for launcher starts; release build is not minified
      (R8 off; the code is mostly the web bundle); the "file downloaded" message is also shown
      after sharing; landscape side insets (camera cutout) are not handled; email links (account
      confirmation) open the website, not the app (App Links: later); the upload key exists only on
      this computer until backed up; iOS needs a Mac for every remaining step.
- [x] **12. Demo mode** — `supabase/demo/seed.sql` (idempotent, plain SQL; `remove.sql`):
      demo municipality "Landkreis Harburg (Demo)" (rough outline), 32 reports (22 in Landkreis
      Harburg, 10 in Hamburg = public area) covering every status and category, incl. hazardous
      reports (one in progress with staff), a duplicate within 30 m, rejected reports, unpublished
      fresh reports; history with confirmations, claims, clean-ups, bags reported/collected; 7 bag
      pickups (5 open → staff route), kg from size or bags. One account per role
      (`supabase/demo/accounts.json`: citizen, volunteer + organizer in the public tenant,
      municipality staff + admin of the demo municipality, super admin), one shared random
      password in git-ignored `demo-login.local` (never printed). Script `npm run demo --` with
      `seed --yes`, `remove`, `status`, `remove-test`, `--env <file>` (accounts via the Auth API; replaces
      `cloud:demo` and `cloud:staff-test`, and removes their old data). App: `VITE_DEMO_MODE` +
      `VITE_DEMO_PASSWORD` (`npm run cloud:frontend-env -- --force --demo`) show "demo data is
      invented" on every app page and one-tap sign-in per role on the profile page. All 6
      languages. Tested: PGlite (demo.test.ts: routing, roles, RLS per role, history consistency,
      idempotency, removal keeps real data), component tests, e2e 56/56, on the cloud project:
      seeded, all 6 accounts sign in with the publishable key, pickups only for staff/admin/super
      admin, roles and profiles as intended.
      Known limits: demo reports have no photos; the switcher was not looked at in a browser or on
      the phone yet (demo mode is off in `.env.local`); a demo-mode build contains the demo
      password, so anyone with it can sign in as super admin of that project (demo projects
      only, documented); admin dashboard, moderation, events are Milestone 2, so admin and super
      admin can do little more than staff today; seeding on the cloud also removed the old
      `lk-harburg` test tenant and 8 own test reports routed to it (as its own `remove` did); since then the demo lives in its own Frankfurt project (`.env.supabase-demo`, `demo:*` scripts) and the Ireland project is kept empty for verify:remote (115/115, see VERIFY_ON_SUPABASE.md); no local
      `supabase db reset` seed (config.toml's `seed.sql` does not exist; use `npm run demo`
      with `--env`).
- [ ] **13. Docs + final test run** — ARCHITECTURE.md (data model, RLS), PLAY_STORE.md (listing in
      de/en/ar, Data Safety answers, closed testing 12+ testers / 14 days), IOS_LATER.md, PITCH.md
      (German), README in English and German (incl. Supabase cloud and Docker deployment, Android
      build), Docker Compose self-hosting, documentation of how automated face / licence-plate
      blurring could be added later; then the full test run (unit, PGlite, e2e, verify:remote).

## Milestone 2

- [ ] Admin dashboard (municipality): table + map of reports in its area, change status, assign to
      staff, internal notes, statistics (open/cleared, average time to clear, by category), CSV and
      GeoJSON export.
- [ ] Cleanup events: create, join, reminders, mark multiple reports cleared at once.
- [ ] Profile: my reports, points and badges (can be disabled per tenant).
- [ ] Moderation: flag abusive content (incl. report comments), block users, review queue.
- [ ] Notifications: email + push when the status of my report changes; push via FCM, APNs
      prepared (Capacitor).
- [ ] Public API following Open311 GeoReport v2.
- [ ] Adopt-a-spot: adopt an area (polygon) and get notified about new reports there.
- [ ] Chronic hotspot detection: 3+ reports within 90 days (configurable) → "chronic" with a
      suggested measure; heatmap in the dashboard.
- [ ] Volunteer certificate: PDF with hours, cleanups, kg, signed by the organizer, QR-verifiable.
- [ ] Prevention mode: bulky waste → how to book the local pickup (link per tenant).
- [ ] Equipment stations: map layer of places to borrow gloves, grabbers, bags.
- [ ] Easy mode: icon-based UI and Leichte Sprache.
- [ ] Challenges: teams compete by cleared reports and kg; team pages, public leaderboard (can be
      disabled per tenant).
- [ ] Impact tracking: estimated kg per report (size + bag count) per user, team, municipality.
