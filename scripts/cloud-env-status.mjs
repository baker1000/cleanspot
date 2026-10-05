#!/usr/bin/env node
// Reports which variables in a cloud project's env file are filled and whether they have the expected
// shape. Prints only "filled"/"empty" and yes/no checks — never a value or any part of one.
//
//   npm run cloud:status            verify project (.env.supabase-cloud)
//   npm run demo:status             demo project (.env.supabase-demo)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCloudTarget, ROOT as root, TARGETS } from './cloud-target.mjs';

const target = loadCloudTarget();
console.log(`${target.fileName} (${target.name} project)`);

// The key list comes from the committed template, so it stays in sync with it.
const KEYS = [
  ...readFileSync(join(root, 'supabase-cloud.env.example'), 'utf8').matchAll(/^([A-Z0-9_]+)=/gm),
].map((m) => m[1]);
const OPTIONAL = new Set(['SUPABASE_DB_CA_CERT', 'MAINTENANCE_SECRET']);

const v = (key) => process.env[key] ?? '';
const ref = v('SUPABASE_PROJECT_REF');

/** The password inside a connection string (decoded), or null if it cannot be parsed. */
function urlPassword(url) {
  try {
    return decodeURIComponent(new URL(url).password);
  } catch {
    return null;
  }
}

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
      url.includes('.pooler.supabase.com:5432/') &&
      urlPassword(url) === v('SUPABASE_DB_PASSWORD')
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
    'should be the Session pooler string (port 5432) for this ref, with exactly SUPABASE_DB_PASSWORD as the password (no [ ])',
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
// The two projects must really be two projects.
const other = Object.entries(TARGETS).find(([name]) => name !== target.name);
if (other && existsSync(join(root, other[1]))) {
  const otherRef = readFileSync(join(root, other[1]), 'utf8').match(
    /^SUPABASE_PROJECT_REF=(.*)$/m,
  )?.[1];
  const same = otherRef?.trim() && otherRef.trim() === ref;
  console.log(`${same ? 'WRONG ' : 'OK    '}  different project than ${other[1]}`);
  if (same) problems++;
}
console.log(
  problems ? `\n${problems} item(s) need attention.` : '\nAll required values look right.',
);
process.exit(problems ? 1 : 0);
