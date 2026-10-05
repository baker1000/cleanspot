# CleanSpot

Open-source app for reporting and clearing illegal waste dumps. Citizens report waste with photo
and location, the reports appear on a map, and volunteers or municipal staff clear them. Made to be
offered to a German municipality (Landkreis) **and** to work as a free public app without one.

**[Deutsche Version: README.de.md](README.de.md)**

## What it does

- **Report in under a minute:** 1–3 photos (compressed, EXIF removed on the device), automatic
  location with an editable pin, category, size, optional comment. No account needed (anonymous
  sign-in). Works offline: reports are queued and sent later.
- **Map:** reports coloured by status (Okabe-Ito, colour-blind safe, never colour alone), filters,
  place search, clustering, list view for keyboard and screen readers.
- **Clear:** confirm reports, "I'll clear this", after-photo that must be taken within 50 m;
  hazardous waste (batteries, chemicals, asbestos, needles) shows "Do not touch" and goes to staff
  only.
- **Bag pickup:** volunteers report "X bags placed here"; municipal staff get an optimised pickup
  route for the day.
- **Multi-tenant:** one installation serves several municipalities (each with its own area,
  staff and settings) plus the public; reports are routed by location.
- **DSGVO:** no tracking, no cookies, EU hosting or self-hosting, data export and account
  deletion in the app, photos public only after review.
- **Platforms:** website + installable PWA, Android app (Capacitor, ready for Google Play), iOS
  prepared. German (default), English, Arabic (RTL), French, Turkish, Ukrainian. Accessibility
  target WCAG 2.1 AA / BITV 2.0.

**Status:** Milestone 1 (MVP) is complete and tested; Milestone 2 (admin dashboard, events,
notifications, moderation queue, Open311, hotspots, …) is not started. See
[ROADMAP.md](ROADMAP.md) for every step, its tests and its known limits.

| Document                                           | Content                                                      |
| -------------------------------------------------- | ------------------------------------------------------------ |
| [ARCHITECTURE.md](ARCHITECTURE.md)                 | Data model, roles, RLS policies, offline sync, testing       |
| [deploy/docker/README.md](deploy/docker/README.md) | Self-hosting with Docker                                     |
| [PLAY_STORE.md](PLAY_STORE.md)                     | Google Play: listing (de/en/ar), Data Safety, closed testing |
| [IOS_LATER.md](IOS_LATER.md)                       | Remaining steps for an App Store release                     |
| [PITCH.md](PITCH.md)                               | Pitch for the municipality (German)                          |
| [docs/PHOTO_BLURRING.md](docs/PHOTO_BLURRING.md)   | How automated face / licence-plate blurring could be added   |
| [VERIFY_ON_SUPABASE.md](VERIFY_ON_SUPABASE.md)     | Results of the tests against real Supabase                   |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)       | What must be done before a public release                    |

## Quick start (local development)

Requirements: Node.js ≥ 22.

```bash
npm install
npm test          # unit + database tests (PGlite, no Docker needed)
npm run dev       # http://127.0.0.1:5173 — without a backend: landing page and map only
```

For a backend, either use a Supabase cloud project (next section) and
`npm run cloud:frontend-env`, or a local Supabase stack with Docker (`npm run db:start`, then copy
`.env.example` to `.env.local` and fill in the values from `npx supabase status`).

## Deployment

### A. Supabase cloud (EU)

1. Create a project at <https://supabase.com> in **Central EU (Frankfurt)**.
2. Copy `supabase-cloud.env.example` to `.env.supabase-cloud` (git-ignored) and fill it in; the
   template says where each value is in the dashboard. `npm run cloud:status` checks the values
   without printing them.
3. `npm run cloud:link`, `npm run cloud:push:dry`, `npm run cloud:push` — applies all migrations
   (schema, functions, RLS, storage bucket, claim expiry job).
4. `npm run cloud:auth-config -- --apply` — turns on anonymous sign-ins (30 per hour and IP).
   In the dashboard set **Authentication → URL Configuration → Site URL** to the app's URL and
   configure SMTP (see [Email](#email-smtp)).
5. `npm run cloud:maintenance` — deploys the maintenance Edge Function and schedules it hourly.
6. A municipality: insert it with its area and add staff (SQL in
   [deploy/docker/README.md, step 4](deploy/docker/README.md#4-municipality-staff-settings); the
   same statements work in the cloud SQL editor).
7. Web app: `npm run cloud:frontend-env` writes `.env.local` (public values only), then
   `npm run build` and host `dist/` on any static host in the EU. Serve `index.html` for every
   path, and `sw.js` / `manifest.webmanifest` with `Cache-Control: no-cache`
   (`deploy/docker/nginx.conf` is a complete example).
8. Before going public: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (legal texts, translations,
   production verification).

This repository uses **two** cloud projects for development, a verify project and a demo project;
see [Two cloud projects](#two-cloud-projects). A production project is a third one: give it its own env file and target in `scripts/cloud-target.mjs` instead of reusing `.env.supabase-cloud`.

### B. Self-hosting with Docker

The official Supabase Docker setup plus a container for the web app: see
[deploy/docker/README.md](deploy/docker/README.md). Written but **not yet tested end to end**.

### Android app

See [Android app (Capacitor)](#android-app-capacitor) below and [PLAY_STORE.md](PLAY_STORE.md).

## Development

Docker Desktop is needed only for the local Supabase stack (`npm run db:start`).

| Command                         | What it does                                                           |
| ------------------------------- | ---------------------------------------------------------------------- |
| `npm test`                      | Unit/component tests (Vitest) + PGlite database tests (no Docker)      |
| `npm run test:e2e`              | Playwright end-to-end tests (`npx playwright install chromium` once)   |
| `npm run lint`                  | ESLint (incl. jsx-a11y)                                                |
| `npm run typecheck`             | TypeScript                                                             |
| `npm run db:start`              | Local Supabase via Docker                                              |
| `npm run db:reset`              | Re-apply all migrations to the local stack (demo data: `npm run demo`) |
| `npm run verify:remote`         | DB + API verification against a real Supabase project (see below)      |
| `npm run i18n:review -- <lang>` | Review sheet for translators in `docs/i18n-review/<lang>.md`           |

### Database tests without Docker

`supabase/tests/lite/` runs the real migrations in [PGlite](https://pglite.dev) with PostGIS, on a minimal shim of Supabase's `auth` schema and API roles. It catches SQL and RLS logic errors quickly, but does not replace testing against a real Supabase stack.

### Two cloud projects

| Project          | Env file (git-ignored) | Scripts                    | Purpose                                          |
| ---------------- | ---------------------- | -------------------------- | ------------------------------------------------ |
| verify (Ireland) | `.env.supabase-cloud`  | `cloud:*`, `verify:remote` | kept **empty**; only for `npm run verify:remote` |
| demo (Frankfurt) | `.env.supabase-demo`   | `demo:*`, `demo`           | demo and pitch: migrations + demo data           |

Both files use the template `supabase-cloud.env.example`; `npm run cloud:status` /
`npm run demo:status` check them (shape only, never values, and that they are two different
projects). Every cloud script takes `--target verify|demo`. Demo project setup:
`npm run demo:push:dry`, `npm run demo:push`, `npm run demo:auth-config -- --apply` (anonymous
sign-ins on, 30/h), `npm run demo:maintenance`, `npm run demo -- seed --yes`,
`npm run demo:frontend-env` (`.env.local` → demo project, demo mode on).

### Verifying against a Supabase cloud project

1. Copy `supabase-cloud.env.example` to `.env.supabase-cloud` (git-ignored) and fill it in; the example explains where each value is in the dashboard.
   `npm run cloud:status` shows which values are filled and whether they look right, without printing them.
2. `npm run cloud:link`, then `npm run cloud:push:dry` (shows what would be applied) and `npm run cloud:push`.
3. `npm run cloud:maintenance` deploys the maintenance Edge Function and sets its secret.
4. `npm run verify:remote` runs the same DB test suites inside a transaction that is rolled back, plus API tests through PostgREST/Storage/Edge Functions. Those create `verify-*` users, a tenant and files and delete them afterwards. Run it on an empty project, before seeding demo data.

Results are tracked in [VERIFY_ON_SUPABASE.md](VERIFY_ON_SUPABASE.md).

### Running the frontend against the cloud project

1. `npm run cloud:frontend-env` (verify project) or `npm run demo:frontend-env` (demo project, demo mode on) writes `.env.local` with **only** the project URL and the publishable key (it refuses secret keys). `.env.local` is git-ignored.
2. Optional: demo data and demo accounts, see [Demo mode](#demo-mode).
3. `npm run dev` and open http://127.0.0.1:5173/app.

## Demo mode

For a pitch or for trying every role. **Only on a project used for demos**: the demo accounts
share one password, and a demo-mode build contains it.

- `npm run demo -- seed --yes` (on the demo project; the verify project is refused) creates the demo municipality **Landkreis Harburg (Demo)** (rough
  outline, not the official border), 32 reports around Hamburg (public area) and Landkreis
  Harburg in every status (incl. a hazardous report in progress with staff, a duplicate, a
  rejected one, timelines with confirmations, claims and clean-ups), 7 bag pickups (5 open, so
  the staff pickup route has stops) and one account per role:

  | Role                                   | E-mail                              |
  | -------------------------------------- | ----------------------------------- |
  | citizen                                | `citizen@demo.cleanspot.invalid`    |
  | volunteer (public area)                | `volunteer@demo.cleanspot.invalid`  |
  | organizer (public area)                | `organizer@demo.cleanspot.invalid`  |
  | municipality_staff (Landkreis Harburg) | `staff@demo.cleanspot.invalid`      |
  | municipality_admin (Landkreis Harburg) | `admin@demo.cleanspot.invalid`      |
  | super_admin                            | `superadmin@demo.cleanspot.invalid` |

  The password is random, kept in `demo-login.local` (git-ignored, reused on the next seed) and
  never printed. Seeding again resets the demo data (and anything the demo accounts did).

- `npm run demo:frontend-env` points `.env.local` at the demo project and turns on demo mode
  (`VITE_DEMO_MODE=true`, `VITE_DEMO_PASSWORD`): every app page says the data is invented, and
  the profile page has one-tap sign-in for each role. Without `--demo` it is off again.
- `npm run demo -- status` counts the demo data; `npm run demo -- remove` deletes it with the
  accounts and their photo files. `--target verify` does the same on the verify project, and
  `npm run demo -- remove-test --target verify` deletes other (own test) reports with their
  photos, since `npm run verify:remote` runs only on a project without data.
- Another project (e.g. a local `supabase start`): `--env <file>` with `SUPABASE_URL`,
  `SUPABASE_SECRET_KEY` and `SUPABASE_DB_URL`. The data itself is plain SQL in
  `supabase/demo/seed.sql` (`remove.sql`), tested in `supabase/tests/lite/demo.test.ts`.
- Demo reports have no photos (no freely licensed pictures of waste dumps are included).

## PWA (installable, offline)

- Production builds (`npm run build`, `npm run preview`) include a service worker (`src/sw/sw.ts`, [vite-plugin-pwa](https://vite-pwa-org.netlify.app) / Workbox, both MIT). `npm run dev` runs without it.
- **Offline:** the app shell and all code are precached, so the app opens without a connection. Map style, tiles, glyphs and sprites of viewed areas are cached (up to 3000 files, 30 days). Reports, photos and other backend answers are not cached; only the landing page's public statistics are.
- **Offline queue + Background Sync:** reports made offline wait in IndexedDB. Where the browser supports Background Sync (Chromium, Android), the service worker sends them when the connection is back, also when the app is closed; elsewhere they are sent the next time the app is open. For that the auth session is mirrored from localStorage into IndexedDB (`src/lib/authStorage.ts`).
- **Updates:** a new version waits until the user taps "Update now" (no reload in the middle of a report).
- **Hosting:** serve `index.html` for every path (SPA fallback), and serve `sw.js` and `manifest.webmanifest` with `Cache-Control: no-cache` so updates are found.
- **Icons:** edit `public/icons/icon.svg` / `icon-maskable.svg`, then `npm run icons` renders the PNGs (Playwright Chromium).
- **Landing page:** live numbers from `public_stats` (migration 9). `VITE_PLAY_STORE_URL` (a `https://play.google.com/…` link) shows the Google Play link; without it the page says the Android app is coming soon.

## Android app (Capacitor)

Requirements: **JDK 21** (`JAVA_HOME`; Gradle 8.14 does not run on JDK 25) and the Android SDK
(`ANDROID_HOME`; missing platforms are downloaded by Gradle on the first build).

- `npm run android:sync` builds the web app and copies it into `android/` (and `ios/`). The
  `VITE_*` values of the build are baked into the app (use the production values for a release).
- `npm run android:apk` → debug APK in `android/app/build/outputs/apk/debug/` (install with
  `adb install -r …`; debuggable in `chrome://inspect`).
- `npm run android:aab` → signed release bundle `android/app/build/outputs/bundle/release/app-release.aab`
  for Google Play.
- `npm run android:open` opens the project in Android Studio.
- **Version:** `versionName` and `versionCode` come from `package.json` (`1.2.3` → code `10203`).
  Bump it before every Play upload: `npm version patch` (or `minor` / `major`).
- **Signing:** `npm run android:keystore` creates the upload key `android/cleanspot-upload.jks`
  and `android/keystore.properties` with a random password (both git-ignored, the password is
  never printed). **Back up both files.** Use Play App Signing: Google keeps the app signing key,
  this key only signs uploads and can be reset through Play support if lost.
  `npm run android:keystore -- status` shows the certificate fingerprint.
- **Icons and splash:** `npm run icons` renders the launcher icons (legacy, round, adaptive
  foreground on CleanSpot green), the PWA icons and the iOS icon/splash from one drawing.
- **Native behaviour:** `Take photo` opens the system camera (never the gallery); location uses
  the Geolocation plugin with the system permission dialog; the data export goes to the share
  sheet; the Android back button follows the app's history; the app opens on the map. Only the
  permissions INTERNET, CAMERA and location are requested; app data is excluded from Android
  backups. The service worker is not used in the app (its files are inside the app); reports made
  offline are sent while the app is open.

## Map and place search

- **Map:** [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause) with the free [OpenFreeMap](https://openfreemap.org) style by default (`VITE_MAP_STYLE_URL`). Map data © OpenStreetMap contributors; the attribution is always visible on the map. For self-hosting, point `VITE_MAP_STYLE_URL` at your own style (e.g. PMTiles).
- **Place search:** `VITE_GEOCODER_PROVIDER=nominatim` (default) or `none` (hides the search). The app follows the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): it searches only when the form is submitted (no autocomplete), sends at most one request per 1.1 s per device, caches results, and shows the OpenStreetMap attribution next to the results. `VITE_GEOCODER_URL` switches to another Nominatim server, `VITE_GEOCODER_COUNTRYCODES` (e.g. `de`) limits results to countries.
- **Accessibility:** every report on the map is also available in the **list view** (keyboard and screen readers, and as a fallback when WebGL is unavailable).
- `npm run check:tiles` is a manual check against the real OpenFreeMap tiles (screenshots in `e2e-manual/test-results/`); the normal E2E tests use a blank local style and never touch the network.

## Email (SMTP)

CleanSpot works fully **without email**: anonymous reporting, the map and all workflows need none. Email is only used by Supabase Auth (account confirmation, password reset) and, later, optional status notifications.

SMTP is configured in `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SENDER_EMAIL`, `SMTP_SENDER_NAME`); for Supabase cloud, enter the same values under **Authentication → Emails → SMTP Settings**.

What happens while SMTP is empty:

| Environment                | Behaviour                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local (`npm run db:start`) | Emails are caught by the built-in test inbox (Mailpit, `http://127.0.0.1:54324`). Nothing leaves your machine.                                                                                                                                                                                                                              |
| Supabase cloud, no SMTP    | Supabase's default mailer only delivers to members of your Supabase organisation and is heavily rate-limited. Fine for testing, **not for real users**.                                                                                                                                                                                     |
| Production, no SMTP        | Choose one: **(a)** configure SMTP (recommended; an EU provider or the municipality's own mail server keeps it DSGVO-friendly), or **(b)** turn off "Confirm email" (Authentication → Providers → Email). Option (b) lets people sign up with addresses they do not own and makes password reset impossible; use it only for closed pilots. |

Anonymous reporting is unaffected by this choice.

## License

[AGPL-3.0](LICENSE)
