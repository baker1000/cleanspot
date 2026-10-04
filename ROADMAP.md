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
      Known limits: sends only while the app is open (Background Sync → step 10); queued reports
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
- [ ] **9. Profile + DSGVO** — account deletion including photos; user data export; leave the
      volunteer role; privacy
      policy, imprint and terms of use (Nutzungsbedingungen) pages (templates marked "must be
      reviewed by a lawyer").
- [ ] **10. PWA** — installable, offline-capable, offline caching of viewed map areas; Background
      Sync for the offline queue where supported (Chromium/Android); landing page with live
      statistics and Google Play link.
- [ ] **11. Capacitor + Android build** — camera, geolocation, file system; signed release AAB,
      versioning, icons, splash, adaptive icon; iOS platform added (Info.plist permission texts),
      not published. Needs **JDK 21** (Capacitor 8 / Gradle 8.14.3 do not run on JDK 25).
- [ ] **12. Demo mode** — seed data around Hamburg / Landkreis Harburg and demo accounts for each
      role.
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
