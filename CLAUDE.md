Read ROADMAP.md at the start of every session and mark steps done when finished.

# CleanSpot — Project Specification

You are a senior full-stack engineer. Build "CleanSpot", a production-ready, open-source app for reporting and clearing illegal waste dumps. It must be good enough to pitch to a German municipality (Landkreis), AND work as a free public app if they decline.

## Product
Citizens report waste with photo + GPS. Reports appear on a map. Volunteers or municipal staff claim and clear them, uploading an "after" photo. Groups can organize cleanup events.
Status flow: reported → confirmed → in_progress → cleared (also: rejected, duplicate).

## Two deployment modes (same codebase)
1. Public mode: anyone can report and clear; community moderation.
2. Municipality mode: a municipality has its own area (polygon), staff accounts, and an admin dashboard. Reports inside its area are routed to it.
Use multi-tenancy: one install can serve several municipalities plus the public.

## Platforms
- One codebase: React web app (website + PWA) wrapped with Capacitor.
- App ID (fixed, never change): `store.thinktools.cleanspot` — Android applicationId and namespace, Java package, Capacitor appId and iOS bundle ID. Based on the owner's domain thinktools.store; a Play Store app ID cannot be changed after the first upload.
- Android: primary native target. Fully build, test, and prepare for Google Play release:
  - signed release AAB, versioning, app icons, splash screen, adaptive icon
  - Play Store listing texts in German, English, Arabic (title, short + full description)
  - Data Safety form answers documented in PLAY_STORE.md
  - privacy policy URL hosted on the website
  - instructions for the closed testing phase (12+ testers, 14 days)
- iOS: keep the project iOS-ready but do NOT publish. Add the Capacitor iOS platform, configure permission texts (camera, location, notifications) in Info.plist, avoid Android-only APIs. Document the remaining steps for a future App Store release in IOS_LATER.md.
- Website: same app deployed as PWA plus a public landing page with project info, live statistics, and Google Play link.
- Responsive: phone, tablet, desktop. Admin dashboard optimized for desktop.
- Native features via Capacitor: camera, geolocation, push notifications (FCM; APNs prepared), file system for offline cache.

## Tech stack
- Frontend: React + TypeScript + Vite, Tailwind CSS, PWA (installable, offline-capable)
- Map: MapLibre GL JS with OpenStreetMap tiles (no Google Maps). Offline caching of viewed areas, marker clustering.
- Backend: Supabase (PostgreSQL + PostGIS, Auth, Storage, Row Level Security), EU region. Must also be self-hostable via Docker Compose so a municipality can run it on its own servers.
- Tests: Vitest + React Testing Library, Playwright for main flows.

## Roles
citizen (optional account, anonymous reporting allowed), volunteer, organizer, municipality_staff, municipality_admin, super_admin. Enforce all permissions with RLS, not only in the UI.

## Milestone 1 (MVP)
- Map screen: markers colored by status with a colour-blind-safe palette (Okabe-Ito: reported = vermilion, confirmed = orange, in progress = blue, cleared = bluish green; colour is never the only cue), filters, place search, user location, clustering, bottom-sheet preview.
- Report flow (under 60 seconds): 1–3 photos, auto GPS (editable pin), category (plastic, construction debris, electronics, mixed, bulky waste, hazardous, other), size (bag, pile, container, truck), optional comment.
- Offline queue: reports saved in IndexedDB and synced when online.
- Report detail: photos, history timeline, actions: confirm, navigate, "I'll clear this", upload after-photo.
- Cleanup verification: the after-photo must be taken within 50 m of the report location; store timestamp.
- Duplicate detection: warn if an open report exists within 30 m.
- Image handling: compress client-side, strip EXIF metadata. Photos stay hidden until reviewed OR auto-approved after N community confirmations (configurable).
- Volunteer bag pickup: after a cleanup, volunteers mark "X bags placed here" with photo + location. This creates a pickup task for municipality staff, with an optimized pickup route for the day.
- Hazardous waste safety: categories like batteries, chemicals, asbestos-like material, needles show a "Do not touch" warning, cannot be claimed by volunteers, and go directly to municipality staff.
- i18n: German (default), English, Arabic (full RTL), French, Turkish, Ukrainian. All strings in translation files.

## Milestone 2
- Admin dashboard (municipality): table + map of reports in its area, change status, assign to staff, internal notes, statistics (open/cleared, average time to clear, by category), export CSV and GeoJSON.
- Cleanup events: create, join, reminders, mark multiple reports cleared at once.
- Profile: my reports, points and badges (can be disabled per tenant).
- Moderation: flag abusive content, block users, review queue.
- Notifications: email + push when the status of my report changes.
- Public API following the Open311 GeoReport v2 standard.
- Adopt-a-spot: users, schools, or companies adopt an area (polygon on map) and get notified about new reports there.
- Chronic hotspot detection: if an area gets 3 or more reports within 90 days (configurable), mark it "chronic" and show it to the municipality with a suggested measure (sign, bin, lighting). Heatmap view in the dashboard.
- Volunteer certificate: auto-generated PDF with hours, cleanups, and kg collected, signed by the organizer, verifiable via QR code.
- Prevention mode: for bulky waste/furniture, show how to book the local bulky-waste pickup (configurable link per tenant).
- Equipment stations: map layer of places to borrow gloves, grabbers, bags.
- Easy mode: icon-based UI and simplified language (Leichte Sprache).
- Challenges: teams (school classes, companies) compete by cleared reports and kg; team pages and public leaderboard (can be disabled per tenant).
- Impact tracking: estimated kg per report (from size + bag count), shown per user, team, and municipality.

## Legal / compliance (Germany)
- DSGVO: data minimization, no tracking/analytics by default, cookie-free, EU hosting, account + data deletion, data export for the user.
- Accessibility: WCAG 2.1 AA (BITV 2.0): keyboard navigation, contrast, screen-reader labels, large touch targets.
- Pages: Impressum, Datenschutzerklärung, Nutzungsbedingungen as editable templates, clearly marked "must be reviewed by a lawyer".
- Never show faces or license plates publicly: moderation step before publishing photos; document how automated blurring could be added later.

## Quality requirements
- Mobile-first, works on cheap Android phones and slow networks.
- Clean folder structure, typed code, ESLint + Prettier, no secrets in code (.env.example).
- Database migrations; seed data with realistic demo reports around Hamburg / Landkreis Harburg for the pitch demo.
- License: AGPL-3.0.

## Deliverables
1. Working app: Milestone 1 complete, then Milestone 2.
2. README in English and German: what it is, setup, deployment (Supabase cloud AND Docker self-hosting), Android build.
3. ARCHITECTURE.md with data model and RLS policy explanation.
4. PLAY_STORE.md and IOS_LATER.md as described above.
5. Demo mode with seed data and demo accounts for each role.
6. PITCH.md in German for the municipality: problem, solution, costs (free/open source), data protection, how to start a pilot.

## How to work
- Start by proposing the data model and folder structure, and wait for my approval.
- Then build milestone by milestone, in small steps. After each step: run tests, list what's done, what's missing, and known issues.
- Ask me before adding any paid service or dependency with an unclear license.
- Be honest: if something is not finished or not tested, say so.
- I communicate in Arabic or English; write code, comments, and docs in English unless a document is specified as German.
