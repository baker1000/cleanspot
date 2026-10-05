#!/usr/bin/env node
// Demo mode data: a demo municipality "Landkreis Harburg (Demo)", reports around Hamburg and
// Landkreis Harburg in every status, open bag pickups, and one account per role
// (supabase/demo/accounts.json, all with the same password).
//
//   npm run demo -- seed --yes     creates/updates the accounts and (re)creates the demo data
//   npm run demo -- remove         deletes demo data, demo accounts and their photo files
//   npm run demo -- status         counts what is there
//   npm run demo -- remove-test    deletes all NON-demo reports (own test submissions), so
//                                  verify:remote can run; their photo files stay in storage
//
// Target: the project in .env.supabase-cloud, or another one with `--env <file>` (same variable
// names: SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_DB_URL). For a local `supabase start` use a
// file with the values from `npx supabase status`.
//
// The demo password is kept in demo-login.local (git-ignored) and reused on every seed; it is
// never printed. A demo-mode web build contains it (VITE_DEMO_PASSWORD), so anyone with that
// build can sign in as every demo role, the super admin included: seed only projects that are
// used for demos, never production.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const root = join(import.meta.dirname, '..');
const DEMO_DIR = join(root, 'supabase', 'demo');
const LOGIN_FILE = join(root, 'demo-login.local');
const ACCOUNTS = JSON.parse(readFileSync(join(DEMO_DIR, 'accounts.json'), 'utf8'));
const DEMO_EMAILS = `%@demo.cleanspot.invalid`;
// Left over from the scripts this one replaced (cloud:demo, cloud:staff-test).
const LEGACY_TENANT = 'lk-harburg';
const LEGACY_EMAIL = 'staff.harburg@cleanspot-test.invalid';
const LEGACY_LOGIN_FILE = join(root, 'cloud-staff-login.local');

const args = process.argv.slice(2);
const command = args[0];
const envIndex = args.indexOf('--env');
const envFile =
  envIndex >= 0 ? resolve(args[envIndex + 1] ?? '') : join(root, '.env.supabase-cloud');
if (!['seed', 'remove', 'remove-test', 'status'].includes(command ?? '')) {
  console.error('Usage: npm run demo -- seed --yes | remove | status | remove-test [--env <file>]');
  process.exit(1);
}
if (command === 'seed' && !args.includes('--yes')) {
  console.error(
    [
      'This creates demo accounts for every role (super admin included) with one shared password.',
      'A demo-mode web build contains that password. Use a project meant for demos only.',
      'Run again with: npm run demo -- seed --yes',
    ].join('\n'),
  );
  process.exit(1);
}

process.loadEnvFile(envFile);
const sql = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(process.env.SUPABASE_DB_URL ?? '')
    ? false
    : process.env.SUPABASE_DB_CA_CERT
      ? { ca: readFileSync(process.env.SUPABASE_DB_CA_CERT, 'utf8') }
      : { rejectUnauthorized: false },
});
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function demoPassword() {
  if (existsSync(LOGIN_FILE)) {
    const line = readFileSync(LOGIN_FILE, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('password='));
    if (line) return line.slice('password='.length);
  }
  return randomBytes(15).toString('base64url');
}

/** Photo files of everything the removal will delete (reports and uploads of demo users). */
async function removeDemoPhotos(extraTenantSlug) {
  const { rows } = await sql.query(
    `select p.storage_path as path from public.report_photos p
     join public.reports r on r.id = p.report_id
     where r.client_id::text like 'de30de30-%'
        or r.tenant_id in (select id from public.tenants where slug = any($2))
        or r.reporter_id in (select id from auth.users where email like $1)
     union
     select o.name from storage.objects o
     where o.bucket_id = 'report-photos'
       and o.owner in (select id from auth.users where email like $1 or email = $3)`,
    [DEMO_EMAILS, ['demo-lk-harburg', extraTenantSlug], LEGACY_EMAIL],
  );
  const paths = rows.map((r) => r.path);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from('report-photos').remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
  return paths.length;
}

async function deleteUsers(where, params) {
  const { rows } = await sql.query(`select id from auth.users where ${where}`, params);
  for (const { id } of rows) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
  }
  return rows.length;
}

async function removeLegacy() {
  const photos = await removeDemoPhotos(LEGACY_TENANT);
  await sql.query(
    `delete from public.reports
     where tenant_id in (select id from public.tenants where slug = $1)`,
    [LEGACY_TENANT],
  );
  const tenants = await sql.query(`delete from public.tenants where slug = $1`, [LEGACY_TENANT]);
  const users = await deleteUsers(`email = $1`, [LEGACY_EMAIL]);
  rmSync(LEGACY_LOGIN_FILE, { force: true });
  if (tenants.rowCount || users)
    console.log(`Removed the old staff test tenant "${LEGACY_TENANT}" (${photos} photo files).`);
}

async function seed() {
  await removeLegacy();
  const photos = await removeDemoPhotos(null);
  const password = demoPassword();
  const existing = new Map(
    (
      await sql.query(`select id, email from auth.users where email like $1`, [DEMO_EMAILS])
    ).rows.map((r) => [r.email, r.id]),
  );
  for (const { email } of ACCOUNTS) {
    const id = existing.get(email);
    const { error } = id
      ? await admin.auth.admin.updateUserById(id, {
          password,
          email_confirm: true,
          ban_duration: 'none',
        })
      : await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`${email}: ${error.message}`);
  }

  await sql.query('begin');
  await sql.query(readFileSync(join(DEMO_DIR, 'seed.sql'), 'utf8'));
  await sql.query('commit');

  writeFileSync(
    LOGIN_FILE,
    [
      '# CleanSpot demo accounts (git-ignored). Same password for every account.',
      '# Remove with: npm run demo -- remove',
      `password=${password}`,
      ...ACCOUNTS.map((a) => `${a.role}=${a.email}`),
      `project=${process.env.SUPABASE_URL}`,
      `seeded=${new Date().toISOString()}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  await status();
  if (photos) console.log(`Removed ${photos} photo files from earlier demo use.`);
  console.log('Logins: demo-login.local (git-ignored; password not printed).');
  console.log('Account switcher in the app: npm run cloud:frontend-env -- --force --demo');
}

async function remove() {
  await removeLegacy();
  const photos = await removeDemoPhotos(null);
  await sql.query('begin');
  await sql.query(readFileSync(join(DEMO_DIR, 'remove.sql'), 'utf8'));
  await sql.query('commit');
  const users = await deleteUsers(`email like $1`, [DEMO_EMAILS]);
  rmSync(LOGIN_FILE, { force: true });
  console.log(`Removed the demo data, ${users} demo accounts and ${photos} photo files.`);
}

async function status() {
  const { rows } = await sql.query(
    `select
       (select count(*)::int from public.reports where client_id::text like 'de30de30-%') as reports,
       (select count(*)::int from public.pickup_tasks t join public.reports r on r.id = t.report_id
        where r.client_id::text like 'de30de30-%' and t.status = 'open') as open_pickups,
       (select count(*)::int from auth.users where email like $1) as accounts,
       exists (select 1 from public.tenants where slug = 'demo-lk-harburg') as demo_tenant,
       (select count(*)::int from public.reports where client_id::text not like 'de30de30-%')
         as other_reports`,
    [DEMO_EMAILS],
  );
  const s = rows[0];
  console.log(
    `Demo: ${s.reports} reports, ${s.open_pickups} open pickups, ${s.accounts}/${ACCOUNTS.length} ` +
      `accounts, municipality ${s.demo_tenant ? 'present' : 'missing'}. ` +
      `Other (non-demo) reports: ${s.other_reports}.`,
  );
}

await sql.connect();
try {
  if (command === 'seed') await seed();
  else if (command === 'remove') await remove();
  else if (command === 'status') await status();
  else {
    const { rowCount } = await sql.query(
      `delete from public.reports where client_id::text not like 'de30de30-%'
         and tenant_id not in (select id from public.tenants where slug = 'demo-lk-harburg')`,
    );
    console.log(`Removed ${rowCount} non-demo reports (photo rows and timeline events with them).`);
  }
} catch (error) {
  await sql.query('rollback').catch(() => {});
  throw error;
} finally {
  await sql.end();
}
