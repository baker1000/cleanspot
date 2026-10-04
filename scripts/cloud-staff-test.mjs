#!/usr/bin/env node
// Test tenant "Landkreis Harburg" with one staff account and a few open bag pickups on the cloud
// project, for trying the staff pages (e.g. /app/pickups) by hand.
//
//   npm run cloud:staff-test -- setup    creates tenant, staff account and demo pickups
//                                        (login written to cloud-staff-login.local, git-ignored)
//   npm run cloud:staff-test -- remove   deletes all of it again (incl. every report routed to
//                                        the test tenant meanwhile and its photo files)
//   npm run cloud:staff-test -- status
//
// verify:remote refuses to run while this tenant exists: run `remove` first.
// The area is a rough outline of Landkreis Harburg (about 15 points), not the official border.
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const SLUG = 'lk-harburg';
const EMAIL = 'staff.harburg@cleanspot-test.invalid';
const PREFIX = 'de30de31-';
const root = join(import.meta.dirname, '..');
const LOGIN_FILE = join(root, 'cloud-staff-login.local');

// Approximate outline (lng lat), clockwise from the north-west; leaves Hamburg out.
const AREA = `SRID=4326;MULTIPOLYGON(((${[
  [9.64, 53.47],
  [9.8, 53.48],
  [9.93, 53.43],
  [10.05, 53.43],
  [10.15, 53.41],
  [10.26, 53.42],
  [10.38, 53.43],
  [10.36, 53.33],
  [10.28, 53.25],
  [10.17, 53.19],
  [10.02, 53.17],
  [9.88, 53.17],
  [9.76, 53.2],
  [9.66, 53.27],
  [9.62, 53.36],
  [9.64, 53.47],
]
  .map(([lng, lat]) => `${lng} ${lat}`)
  .join(', ')})))`;

// Cleared reports with bags waiting at the road: [lng, lat, category, size, bags, place]
const PICKUPS = [
  [9.8712, 53.3268, 'mixed', 'pile', 4, 'Buchholz, Parkplatz am Waldweg'],
  [9.7069, 53.2843, 'plastic', 'bag', 2, 'Tostedt, Bahnhofstraße'],
  [10.2142, 53.3571, 'mixed', 'pile', 5, 'Winsen (Luhe), Luhe-Ufer'],
  [10.0428, 53.3944, 'bulky', 'pile', 3, 'Seevetal-Hittfeld, Feldweg'],
  [9.9116, 53.3874, 'plastic', 'bag', 2, 'Rosengarten-Nenndorf, Bushaltestelle'],
  [10.1695, 53.2412, 'mixed', 'pile', 6, 'Salzhausen, Waldrand'],
];

const command = process.argv[2];
if (!['setup', 'remove', 'status'].includes(command ?? '')) {
  console.error('Usage: npm run cloud:staff-test -- setup | remove | status');
  process.exit(1);
}

process.loadEnvFile(join(root, '.env.supabase-cloud'));
const sql = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: process.env.SUPABASE_DB_CA_CERT
    ? { ca: readFileSync(process.env.SUPABASE_DB_CA_CERT, 'utf8') }
    : { rejectUnauthorized: false },
});
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function remove() {
  const { rows } = await sql.query(`select id from public.tenants where slug = $1`, [SLUG]);
  const tenantId = rows[0]?.id;
  if (tenantId) {
    const photos = await sql.query(
      `select p.storage_path from public.report_photos p
       join public.reports r on r.id = p.report_id where r.tenant_id = $1`,
      [tenantId],
    );
    const paths = photos.rows.map((r) => r.storage_path);
    if (paths.length) await admin.storage.from('report-photos').remove(paths);
    const reports = await sql.query(`delete from public.reports where tenant_id = $1`, [tenantId]);
    await sql.query(`delete from public.tenants where id = $1`, [tenantId]);
    console.log(`Removed tenant ${SLUG} with ${reports.rowCount} reports, ${paths.length} photos.`);
  }
  const users = await sql.query(`select id from auth.users where email = $1`, [EMAIL]);
  for (const { id } of users.rows) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
    console.log('Removed the staff account.');
  }
  rmSync(LOGIN_FILE, { force: true });
}

await sql.connect();
try {
  if (command === 'status') {
    const { rows } = await sql.query(
      `select t.slug,
              (select count(*)::int from public.reports r where r.tenant_id = t.id) as reports,
              (select count(*)::int from public.pickup_tasks p
               where p.tenant_id = t.id and p.status = 'open') as open_pickups,
              (select count(*)::int from public.memberships m where m.tenant_id = t.id) as members
       from public.tenants t where t.slug = $1`,
      [SLUG],
    );
    console.log(rows.length ? rows[0] : `No tenant ${SLUG} on the project.`);
  } else if (command === 'remove') {
    await remove();
  } else {
    await remove();
    const password = randomBytes(15).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const userId = data.user.id;

    await sql.query('begin');
    const t = await sql.query(
      `insert into public.tenants (slug, name, kind, area)
       values ($1, 'Landkreis Harburg (Test)', 'municipality', $2::extensions.geography)
       returning id`,
      [SLUG, AREA],
    );
    const tenantId = t.rows[0].id;
    await sql.query(`update public.profiles set display_name = 'Test-Mitarbeiter' where id = $1`, [
      userId,
    ]);
    await sql.query(
      `insert into public.memberships (user_id, tenant_id, role)
       values ($1, $2, 'municipality_staff')`,
      [userId, tenantId],
    );
    for (const [i, [lng, lat, category, size, bags, place]] of PICKUPS.entries()) {
      const point = `SRID=4326;POINT(${lng} ${lat})`;
      const routed = await sql.query(
        `select public.tenant_for_point($1::extensions.geography) as id`,
        [point],
      );
      if (routed.rows[0].id !== tenantId) throw new Error(`${place} is outside the test area`);
      const daysAgo = i + 1;
      const r = await sql.query(
        `insert into public.reports
           (client_id, tenant_id, location, category, size, comment, status, is_published,
            estimated_kg, cleared_at, created_at, updated_at)
         values ($1, $2, $3::extensions.geography, $4::public.report_category,
                 $5::public.report_size, $6, 'cleared', true, $7 * 6,
                 now() - interval '2 hours', now() - make_interval(days => $8),
                 now() - interval '2 hours')
         returning id`,
        [
          `${PREFIX}0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
          tenantId,
          point,
          category,
          size,
          `[Test] ${place}`,
          bags,
          daysAgo,
        ],
      );
      await sql.query(
        `insert into public.report_events (report_id, type, to_status, created_at)
         values ($1, 'created', 'reported', now() - make_interval(days => $2))`,
        [r.rows[0].id, daysAgo],
      );
      // Bags a few metres from the report, as a volunteer would leave them at the road.
      await sql.query(
        `insert into public.pickup_tasks
           (report_id, tenant_id, location, accuracy_m, distance_to_report_m, bag_count,
            estimated_kg, created_at)
         values ($1, $2, extensions.st_project($3::extensions.geography, 25, radians(90)),
                 8, 25, $4, $4 * 6, now() - interval '1 hour')`,
        [r.rows[0].id, tenantId, point, bags],
      );
    }
    await sql.query('commit');

    writeFileSync(
      LOGIN_FILE,
      [
        '# CleanSpot cloud staff test account (git-ignored). Delete with:',
        '#   npm run cloud:staff-test -- remove',
        `email=${EMAIL}`,
        `password=${password}`,
        `tenant=${SLUG} (Landkreis Harburg, municipality_staff)`,
        `created=${new Date().toISOString()}`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    console.log(`Created tenant ${SLUG}, the staff account and ${PICKUPS.length} open pickups.`);
    console.log('Login: cloud-staff-login.local (git-ignored). Password not printed.');
    console.log('verify:remote is blocked until: npm run cloud:staff-test -- remove');
  }
} catch (error) {
  await sql.query('rollback').catch(() => {});
  throw error;
} finally {
  await sql.end();
}
