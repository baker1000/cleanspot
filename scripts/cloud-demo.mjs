#!/usr/bin/env node
// Demo reports around Stelle (Landkreis Harburg) on the cloud project, for looking at the map.
//
//   npm run cloud:demo -- seed     adds the demo reports (replaces earlier demo reports)
//   npm run cloud:demo -- remove   deletes them again (and their timeline events)
//   npm run cloud:demo -- status   counts them
//   npm run cloud:demo -- remove-test   deletes all NON-demo reports (own test submissions),
//                                       so verify:remote can run; photo files stay in storage
//
// Every demo report has a client_id starting with DEMO_PREFIX and a comment starting with
// "[Demo]", so removal never touches real reports. They belong to the public tenant and have
// no reporter (no user accounts are created).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const DEMO_PREFIX = 'de30de30-';
const command = process.argv[2];
if (!['seed', 'remove', 'remove-test', 'status'].includes(command ?? '')) {
  console.error('Usage: npm run cloud:demo -- seed | remove | remove-test | status');
  process.exit(1);
}

process.loadEnvFile(join(import.meta.dirname, '..', '.env.supabase-cloud'));
const sql = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: process.env.SUPABASE_DB_CA_CERT
    ? { ca: readFileSync(process.env.SUPABASE_DB_CA_CERT, 'utf8') }
    : { rejectUnauthorized: false },
});

// [lng, lat, category, size, status, confirmations, daysAgo, comment]
const REPORTS = [
  [10.1105, 53.3842, 'bulky', 'pile', 'reported', 0, 1, 'Alte Matratze und Stuhl am Feldweg'],
  [10.1162, 53.3871, 'plastic', 'bag', 'confirmed', 2, 3, 'Mehrere Plastiksäcke im Graben'],
  [
    10.1031,
    53.3807,
    'construction',
    'container',
    'confirmed',
    3,
    6,
    'Bauschutt hinter dem Parkplatz',
  ],
  [10.1228, 53.3795, 'electronics', 'pile', 'reported', 0, 0, 'Alter Fernseher und Kabel'],
  [10.0989, 53.3889, 'mixed', 'bag', 'in_progress', 1, 4, 'Müllbeutel am Waldrand'],
  [10.1274, 53.3912, 'hazardous', 'bag', 'reported', 0, 2, 'Kanister mit unbekannter Flüssigkeit'],
  [10.1063, 53.3934, 'mixed', 'pile', 'cleared', 3, 12, 'Gemischter Müll an der Bushaltestelle'],
  [10.1189, 53.3758, 'bulky', 'truck', 'confirmed', 4, 9, 'Sofa, Schrank und Teppich'],
  [10.0921, 53.3826, 'plastic', 'bag', 'reported', 0, 0, 'Verpackungsmüll am Spielplatz'],
  [10.1342, 53.3851, 'other', 'pile', 'reported', 1, 5, 'Autoreifen am Feldrand'],
  [10.0835, 53.3712, 'mixed', 'bag', 'confirmed', 2, 7, 'Müll am Radweg Richtung Ashausen'],
  [10.0779, 53.3689, 'hazardous', 'pile', 'confirmed', 2, 8, 'Batterien und Farbeimer'],
  [
    10.1418,
    53.3768,
    'construction',
    'pile',
    'in_progress',
    2,
    10,
    'Fliesen und Rigips am Wirtschaftsweg',
  ],
  [10.2105, 53.3577, 'bulky', 'pile', 'reported', 0, 2, 'Sperrmüll in Winsen (Luhe)'],
  [10.2041, 53.3612, 'plastic', 'bag', 'cleared', 3, 15, 'Plastikmüll am Luhe-Ufer'],
];
const HAZARD = {
  'Kanister mit unbekannter Flüssigkeit': 'chemicals',
  'Batterien und Farbeimer': 'batteries',
};

const removeDemo = () =>
  sql.query(`delete from public.reports where client_id::text like $1`, [`${DEMO_PREFIX}%`]);

await sql.connect();
try {
  if (command === 'status') {
    const { rows } = await sql.query(
      `select count(*)::int as n from public.reports where client_id::text like $1`,
      [`${DEMO_PREFIX}%`],
    );
    console.log(`${rows[0].n} demo reports on the project.`);
  } else if (command === 'remove-test') {
    const { rowCount } = await sql.query(
      `delete from public.reports where client_id::text not like $1`,
      [`${DEMO_PREFIX}%`],
    );
    console.log(
      `Removed ${rowCount} non-demo reports (photos rows and timeline events with them).`,
    );
  } else if (command === 'remove') {
    const { rowCount } = await removeDemo();
    console.log(`Removed ${rowCount} demo reports (timeline events are deleted with them).`);
  } else {
    await sql.query('begin');
    await removeDemo();
    for (const [
      i,
      [lng, lat, category, size, status, confirmations, daysAgo, comment],
    ] of REPORTS.entries()) {
      const clientId = `${DEMO_PREFIX}0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
      const { rows } = await sql.query(
        `insert into public.reports
           (client_id, tenant_id, location, category, hazard_type, size, comment, status,
            is_published, confirmation_count, estimated_kg, cleared_at, created_at, updated_at)
         select $1::uuid, t.id, p.pt, $4::public.report_category,
                $5::public.hazard_type, $6::public.report_size, $7, $8::public.report_status,
                $9 >= 3, $9,
                -- Same estimate as submit_report: the tenant's kg_per_size setting.
                (public.tenant_settings(t.id) -> 'kg_per_size' ->> $6::text)::numeric,
                case when $8::text = 'cleared' then now() - interval '1 day' end,
                now() - make_interval(days => $10), now() - make_interval(days => $10)
         from (select extensions.st_setsrid(extensions.st_makepoint($2, $3), 4326)::extensions.geography as pt) p
         cross join lateral (select public.tenant_for_point(p.pt) as id) t
         returning id`,
        [
          clientId,
          lng,
          lat,
          category,
          HAZARD[comment] ?? null,
          size,
          `[Demo] ${comment}`,
          status,
          confirmations,
          daysAgo,
        ],
      );
      await sql.query(
        `insert into public.report_events (report_id, type, to_status, created_at)
         values ($1, 'created', 'reported', now() - make_interval(days => $2))`,
        [rows[0].id, daysAgo],
      );
    }
    await sql.query('commit');
    console.log(`Added ${REPORTS.length} demo reports around Stelle / Landkreis Harburg.`);
    console.log('Remove them with: npm run cloud:demo -- remove');
  }
} catch (error) {
  await sql.query('rollback').catch(() => {});
  throw error;
} finally {
  await sql.end();
}
