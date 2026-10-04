#!/usr/bin/env node
// Prints the auth settings that CleanSpot depends on, read from the Supabase Management API.
// The auth config also contains secrets (SMTP password, hook secrets); only the allow-listed,
// non-secret fields below are ever printed.
//
//   npm run cloud:auth-config
import { join } from 'node:path';

process.loadEnvFile(join(import.meta.dirname, '..', '.env.supabase-cloud'));
const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = process.env;
if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF must be filled in.');
  process.exit(1);
}

const FIELDS = [
  'external_anonymous_users_enabled',
  'rate_limit_anonymous_users',
  'rate_limit_email_sent',
  'rate_limit_verify',
  'rate_limit_token_refresh',
  'mailer_autoconfirm',
  'site_url',
];

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`Management API returned HTTP ${res.status}.`);
  process.exit(1);
}
const config = await res.json();
for (const field of FIELDS) console.log(`${field}: ${JSON.stringify(config[field] ?? null)}`);
