# `maintenance` Edge Function

Runs hourly:

1. `expire_stale_claims()`: releases claims older than the tenant's `claim_expiry_hours` (default 72). This also runs on its own via pg_cron (migration 3), so it works without Edge Functions too.
2. Orphan cleanup: files in `report-photos` that were uploaded but not attached to a report within 24 h are deleted **through the Storage API**. Deleting `storage.objects` rows in SQL would leave the files behind.

## Setup (once per environment)

```bash
# Shared secret between pg_cron and the function
npx supabase secrets set MAINTENANCE_SECRET=<random, e.g. openssl rand -hex 32>
npx supabase functions deploy maintenance --no-verify-jwt
```

Then in the SQL editor:

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/maintenance', 'maintenance_url');
select vault.create_secret('<same secret as above>', 'maintenance_secret');

create extension if not exists pg_net;
select cron.schedule(
  'cleanspot-maintenance',
  '17 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'maintenance_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-maintenance-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'maintenance_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

For self-hosting with Docker, use `http://kong:8000/functions/v1/maintenance` as the URL.

## Security

JWT verification is off for this function (`config.toml`). Access is protected by `MAINTENANCE_SECRET`, compared in constant time; the function refuses every call if the secret is not set.
