// @vitest-environment node
// Migration 9: public_stats() for the landing page. Compares before/after, so it also runs on a
// verification project that already holds other test data.
import { randomUUID } from 'node:crypto';
import { asActor, createTestDb, type Db } from './harness';

let db: Db;
let tenant: string;

type Stats = {
  reports: number;
  open: number;
  cleared: number;
  cleared_last_30_days: number;
  kg_cleared: number;
  municipalities: number;
};

const stats = async (sub: string | null = null) =>
  (await asActor<{ s: Stats }>(db, { sub }, `select public_stats() as s`))[0]!.s;

async function insertReport(status: string, opts: { kg?: number; clearedDaysAgo?: number } = {}) {
  const cleared = status === 'cleared';
  const duplicateOf =
    status === 'duplicate'
      ? (
          await db.query<{ id: string }>(`select id from reports where tenant_id = $1 limit 1`, [
            tenant,
          ])
        ).rows[0]!.id
      : null;
  await db.query(
    `insert into reports (client_id, tenant_id, location, category, size, status, estimated_kg,
                          cleared_at, duplicate_of)
     values ($1, $2, 'SRID=4326;POINT(10.1 53.3)', 'mixed', 'pile', $3::report_status, $4,
             case when $5::int is null then null else now() - make_interval(days => $5::int) end,
             $6)`,
    [
      randomUUID(),
      tenant,
      status,
      opts.kg ?? null,
      cleared ? (opts.clearedDaysAgo ?? 1) : null,
      duplicateOf,
    ],
  );
}

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  if (tenant) {
    await db.query(`delete from reports where tenant_id = $1`, [tenant]);
    await db.query(`delete from tenants where id = $1`, [tenant]);
  }
  await db?.close();
});

describe('public_stats', () => {
  it('counts open and cleared reports and kg, not rejected ones or duplicates', async () => {
    const before = await stats();
    const { rows } = await db.query<{ id: string }>(
      `insert into tenants (slug, name, kind, area)
       values ($1, 'Verify Stats', 'municipality',
               'SRID=4326;MULTIPOLYGON(((10 53.2, 10.2 53.2, 10.2 53.4, 10 53.4, 10 53.2)))')
       returning id`,
      [`verify-stats-${randomUUID().slice(0, 8)}`],
    );
    tenant = rows[0]!.id;

    await insertReport('reported');
    await insertReport('confirmed');
    await insertReport('in_progress');
    await insertReport('cleared', { kg: 40.4, clearedDaysAgo: 2 });
    await insertReport('cleared', { kg: 12, clearedDaysAgo: 60 });
    await insertReport('rejected');
    await insertReport('duplicate');

    const after = await stats();
    expect({
      reports: after.reports - before.reports,
      open: after.open - before.open,
      cleared: after.cleared - before.cleared,
      cleared_last_30_days: after.cleared_last_30_days - before.cleared_last_30_days,
      municipalities: after.municipalities - before.municipalities,
    }).toEqual({ reports: 5, open: 3, cleared: 2, cleared_last_30_days: 1, municipalities: 1 });
    // Rounded per call over all reports, so compare with a tolerance of one.
    expect(Math.abs(after.kg_cleared - before.kg_cleared - 52)).toBeLessThanOrEqual(1);
  });

  it('is readable without an account and with one', async () => {
    await expect(stats(null)).resolves.toHaveProperty('reports');
    await expect(stats(randomUUID())).resolves.toHaveProperty('reports');
  });
});
