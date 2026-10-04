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
