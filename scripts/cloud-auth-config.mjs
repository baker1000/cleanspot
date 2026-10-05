#!/usr/bin/env node
// Prints the auth settings that CleanSpot depends on, read from the Supabase Management API.
// The auth config also contains secrets (SMTP password, hook secrets); only the allow-listed,
// non-secret fields below are ever printed.
//
//   npm run cloud:auth-config                      verify project
//   npm run demo:auth-config                       demo project
//   ... -- --apply                                 first sets what CleanSpot needs (REQUIRED)
import { loadCloudTarget } from './cloud-target.mjs';

const { args } = loadCloudTarget();
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

// Anonymous reporting needs anonymous sign-ins; their rate limit is per hour and IP.
const REQUIRED = { external_anonymous_users_enabled: true, rate_limit_anonymous_users: 30 };
if (args.includes('--apply')) {
  const patch = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(REQUIRED),
  });
  if (!patch.ok) {
    console.error(`Management API returned HTTP ${patch.status} for the update.`);
    process.exit(1);
  }
  console.log(`Applied: ${JSON.stringify(REQUIRED)}`);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`Management API returned HTTP ${res.status}.`);
  process.exit(1);
}
const config = await res.json();
for (const field of FIELDS) console.log(`${field}: ${JSON.stringify(config[field] ?? null)}`);
