# CleanSpot

Open-source app for reporting and clearing illegal waste dumps. Citizens report waste with photo + GPS, volunteers and municipal staff clear it.

> **Status: early development (Milestone 1, step 1).** Not usable yet. Full English and German documentation follows with Milestone 1.

## Development

Requirements: Node.js ≥ 22. Docker Desktop is needed for the local Supabase stack (`npm run db:start`).

```bash
npm install
cp .env.example .env.local   # fill in values from `npx supabase status`
npm run dev
```

| Command             | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `npm test`          | Unit/component tests (Vitest) + PGlite database tests (no Docker)    |
| `npm run test:e2e`  | Playwright end-to-end tests (`npx playwright install chromium` once) |
| `npm run lint`      | ESLint (incl. jsx-a11y)                                              |
| `npm run typecheck` | TypeScript                                                           |
| `npm run db:start`  | Local Supabase via Docker                                            |
| `npm run db:reset`  | Re-apply migrations + seed                                           |
| `npm run db:test`   | pgTAP tests against local Supabase (Docker)                          |

### Database tests without Docker

`supabase/tests/lite/` runs the real migrations in [PGlite](https://pglite.dev) with PostGIS, on a minimal shim of Supabase's `auth` schema and API roles. It catches SQL and RLS logic errors quickly, but does not replace testing against a real Supabase stack.

## License

[AGPL-3.0](LICENSE)
