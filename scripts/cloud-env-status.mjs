#!/usr/bin/env node
// Reports which variables in .env.supabase-cloud are filled and whether they have the expected
// shape. Prints only "filled"/"empty" and yes/no checks — never a value or any part of one.
//
//   npm run cloud:status
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const ENV_FILE = join(root, '.env.supabase-cloud');
if (!existsSync(ENV_FILE)) {
  console.error('Missing .env.supabase-cloud — copy supabase-cloud.env.example and fill it in.');
  process.exit(1);
}

// The key list comes from the committed template, so it stays in sync with it.
const KEYS = [
  ...readFileSync(join(root, 'supabase-cloud.env.example'), 'utf8').matchAll(/^([A-Z0-9_]+)=/gm),
].map((m) => m[1]);
const OPTIONAL = new Set(['SUPABASE_DB_CA_CERT', 'MAINTENANCE_SECRET']);

process.loadEnvFile(ENV_FILE);
const v = (key) => process.env[key] ?? '';
const ref = v('SUPABASE_PROJECT_REF');

// Shape checks: each returns true/false; undefined means "nothing to check".
const CHECKS = {
  SUPABASE_ACCESS_TOKEN: () => v('SUPABASE_ACCESS_TOKEN').startsWith('sbp_'),
  SUPABASE_PROJECT_REF: () => /^[a-z0-9]{20}$/.test(ref),
  SUPABASE_DB_PASSWORD: () => !/^\[.*\]$/.test(v('SUPABASE_DB_PASSWORD')),
  SUPABASE_DB_URL: () => {
    const url = v('SUPABASE_DB_URL');
    return (
      /^postgres(ql)?:\/\//.test(url) &&
      !url.includes('[YOUR-PASSWORD]') &&
      url.includes(`postgres.${ref}:`) &&
      url.includes('.pooler.supabase.com:5432/')
    );
  },
  SUPABASE_URL: () => v('SUPABASE_URL').replace(/\/$/, '') === `https://${ref}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY: () => /^(sb_publishable_|eyJ)/.test(v('SUPABASE_PUBLISHABLE_KEY')),
  SUPABASE_SECRET_KEY: () => /^(sb_secret_|eyJ)/.test(v('SUPABASE_SECRET_KEY')),
  SUPABASE_DB_CA_CERT: () => existsSync(v('SUPABASE_DB_CA_CERT')),
};

const HINTS = {
  SUPABASE_ACCESS_TOKEN: 'should start with sbp_',
  SUPABASE_PROJECT_REF: 'should be 20 lowercase letters/digits',
  SUPABASE_DB_PASSWORD: 'looks like a placeholder',
  SUPABASE_DB_URL:
    'should be the Session pooler string (port 5432) for this ref, password filled in',
  SUPABASE_URL: 'should be https://<SUPABASE_PROJECT_REF>.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'should start with sb_publishable_ (or eyJ for the legacy anon key)',
  SUPABASE_SECRET_KEY: 'should start with sb_secret_ (or eyJ for the legacy service_role key)',
  SUPABASE_DB_CA_CERT: 'file not found at that path',
};

let problems = 0;
for (const key of KEYS) {
  const filled = v(key) !== '';
  let line = `${filled ? 'filled' : 'empty '}  ${key}`;
  if (!filled) {
    if (OPTIONAL.has(key)) line += '  (optional)';
    else problems++;
  } else if (CHECKS[key]) {
    const ok = CHECKS[key]();
    line += ok ? '  shape OK' : `  shape WRONG: ${HINTS[key]}`;
    if (!ok) problems++;
  }
  console.log(line);
}
console.log(
  problems ? `\n${problems} item(s) need attention.` : '\nAll required values look right.',
);
process.exit(problems ? 1 : 0);
