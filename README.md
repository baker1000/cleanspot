# CleanSpot

Open-source app for reporting and clearing illegal waste dumps. Citizens report waste with photo + GPS, volunteers and municipal staff clear it.

> **Status: early development (Milestone 1).** Not usable yet. Full English and German documentation follows with Milestone 1.

## Development

Requirements: Node.js ≥ 22. Docker Desktop is needed for the local Supabase stack (`npm run db:start`).

```bash
npm install
cp .env.example .env.local   # fill in values from `npx supabase status`
npm run dev
```

| Command                         | What it does                                                         |
| ------------------------------- | -------------------------------------------------------------------- |
| `npm test`                      | Unit/component tests (Vitest) + PGlite database tests (no Docker)    |
| `npm run test:e2e`              | Playwright end-to-end tests (`npx playwright install chromium` once) |
| `npm run lint`                  | ESLint (incl. jsx-a11y)                                              |
| `npm run typecheck`             | TypeScript                                                           |
| `npm run db:start`              | Local Supabase via Docker                                            |
| `npm run db:reset`              | Re-apply migrations + seed                                           |
| `npm run db:test`               | pgTAP tests against local Supabase (Docker)                          |
| `npm run verify:remote`         | DB + API verification against a real Supabase project (see below)    |
| `npm run i18n:review -- <lang>` | Review sheet for translators in `docs/i18n-review/<lang>.md`         |

### Database tests without Docker

`supabase/tests/lite/` runs the real migrations in [PGlite](https://pglite.dev) with PostGIS, on a minimal shim of Supabase's `auth` schema and API roles. It catches SQL and RLS logic errors quickly, but does not replace testing against a real Supabase stack.

### Verifying against a Supabase cloud project

1. Copy `supabase-cloud.env.example` to `.env.supabase-cloud` (git-ignored) and fill it in; the example explains where each value is in the dashboard.
   `npm run cloud:status` shows which values are filled and whether they look right, without printing them.
2. `npm run cloud:link`, then `npm run cloud:push:dry` (shows what would be applied) and `npm run cloud:push`.
3. `npm run cloud:maintenance` deploys the maintenance Edge Function and sets its secret.
4. `npm run verify:remote` runs the same DB test suites inside a transaction that is rolled back, plus API tests through PostgREST/Storage/Edge Functions. Those create `verify-*` users, a tenant and files and delete them afterwards. Run it on an empty project, before seeding demo data.

Results are tracked in [VERIFY_ON_SUPABASE.md](VERIFY_ON_SUPABASE.md).

### Running the frontend against the cloud project

1. `npm run cloud:frontend-env` writes `.env.local` with **only** the project URL and the publishable key (it refuses secret keys). `.env.local` is git-ignored.
2. Optional: `npm run cloud:demo -- seed` adds 15 demo reports around Stelle / Landkreis Harburg (marked `[Demo]`, no user accounts). `npm run cloud:demo -- status` counts them, `npm run cloud:demo -- remove` deletes them. Remove them before `npm run verify:remote`, which only runs on a project without reports.
3. Optional: `npm run cloud:staff-test -- setup` creates a test tenant "Landkreis Harburg (Test)" (rough outline) with one staff account and 6 open bag pickups, for trying `/app/pickups`. The login is written to `cloud-staff-login.local` (git-ignored; the password is never printed). `-- status` / `-- remove`; remove it before `npm run verify:remote`.
4. `npm run dev` and open http://127.0.0.1:5173/app.

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
