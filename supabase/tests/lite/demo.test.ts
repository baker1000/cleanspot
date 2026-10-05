// @vitest-environment node
// Demo data (supabase/demo/seed.sql + remove.sql): runs on the real migrations.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import accounts from '../../demo/accounts.json';
import { asActor, createTestDb, DB_TARGET, type Db } from './harness';

const DEMO_DIR = join(import.meta.dirname, '..', '..', 'demo');
const SEED = readFileSync(join(DEMO_DIR, 'seed.sql'), 'utf8');
const REMOVE = readFileSync(join(DEMO_DIR, 'remove.sql'), 'utf8');
const ALL_STATUSES = ['reported', 'confirmed', 'in_progress', 'cleared', 'rejected', 'duplicate'];
const ALL_CATEGORIES = [
  'plastic',
  'construction',
  'electronics',
  'mixed',
  'bulky',
  'hazardous',
  'other',
];

let db: Db;
const ids: Record<string, string> = {};
const user = (role: string) => ({ sub: ids[role]! });

// Seeding needs the accounts in auth.users, which only the Auth API creates on a real project.
describe.skipIf(DB_TARGET === 'remote')('demo data', () => {
  beforeAll(async () => {
    db = await createTestDb();
  }, 60_000);
  afterAll(() => db.close());

  it('refuses to run before the demo accounts exist', async () => {
    await expect(db.exec(SEED)).rejects.toThrow(/Demo accounts missing: citizen@/);
    // Nothing half-done is left behind (the caller runs it in one transaction).
  });

  it('seeds a municipality, the public area and an account for every role', async () => {
    for (const a of accounts) {
      const id = randomUUID();
      ids[a.role] = id;
      await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, a.email]);
    }
    // A real report that must survive seeding and removal.
    await db.query(
      `insert into public.reports (client_id, tenant_id, location, category, size)
       select $1, t.id, 'SRID=4326;POINT(10.1 53.38)', 'mixed', 'bag'
       from public.tenants t where t.kind = 'public'`,
      [randomUUID()],
    );
    await db.exec(SEED);
    await db.exec(SEED); // idempotent

    const { rows: counts } = await db.query<{ n: number; tenant: string }>(
      `select t.slug as tenant, count(*)::int as n from public.reports r
       join public.tenants t on t.id = r.tenant_id
       where r.comment like '[Demo] %' group by t.slug order by t.slug`,
    );
    expect(counts).toEqual([
      { tenant: 'demo-lk-harburg', n: 22 },
      { tenant: 'public', n: 10 },
    ]);

    const roles = await db.query<{ email: string; role: string | null; sa: boolean }>(
      `select u.email, m.role::text as role, p.is_super_admin as sa
       from auth.users u join public.profiles p on p.id = u.id
       left join public.memberships m on m.user_id = u.id order by u.email`,
    );
    expect(roles.rows).toEqual([
      { email: 'admin@demo.cleanspot.invalid', role: 'municipality_admin', sa: false },
      { email: 'citizen@demo.cleanspot.invalid', role: null, sa: false },
      { email: 'organizer@demo.cleanspot.invalid', role: 'organizer', sa: false },
      { email: 'staff@demo.cleanspot.invalid', role: 'municipality_staff', sa: false },
      { email: 'superadmin@demo.cleanspot.invalid', role: null, sa: true },
      { email: 'volunteer@demo.cleanspot.invalid', role: 'volunteer', sa: false },
    ]);
  });

  it('covers every status and category, with consistent history and dates', async () => {
    const { rows } = await db.query<{
      status: string;
      category: string;
      last_status: string;
      created_ok: boolean;
      order_ok: boolean;
      confirmations_ok: boolean;
      kg: string | null;
    }>(
      `select r.status::text, r.category::text,
              (select e.to_status::text from public.report_events e
               where e.report_id = r.id and e.to_status is not null
               order by e.created_at desc, e.id desc limit 1) as last_status,
              (select e.type = 'created' from public.report_events e
               where e.report_id = r.id order by e.created_at, e.id limit 1) as created_ok,
              (select bool_and(e.created_at >= r.created_at and e.created_at <= now())
               from public.report_events e where e.report_id = r.id) as order_ok,
              r.confirmation_count =
                (select count(*) from public.report_confirmations c where c.report_id = r.id)
                as confirmations_ok,
              r.estimated_kg::text as kg
       from public.reports r where r.comment like '[Demo] %'`,
    );
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(ALL_STATUSES));
    expect(new Set(rows.map((r) => r.category))).toEqual(new Set(ALL_CATEGORIES));
    for (const r of rows) {
      expect(r).toMatchObject({
        // A confirmation changes the status without a status event (as confirm_report does).
        last_status: r.status === 'confirmed' ? 'reported' : r.status,
        created_ok: true,
        order_ok: true,
        confirmations_ok: true,
      });
      expect(Number(r.kg)).toBeGreaterThan(0);
    }

    const dup = await db.query<{ m: number }>(
      `select extensions.st_distance(d.location, o.location) as m
       from public.reports d join public.reports o on o.id = d.duplicate_of`,
    );
    expect(dup.rows).toHaveLength(1);
    expect(dup.rows[0]!.m).toBeLessThan(30);
  });

  it('the staff account has a pickup route; others may not see it', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from public.tenants where slug = 'demo-lk-harburg'`,
    );
    const tenant = rows[0]!.id;
    const open = await asActor<{ bag_count: number }>(
      db,
      user('municipality_staff'),
      `select * from open_pickup_tasks($1)`,
      [tenant],
    );
    expect(open).toHaveLength(5);
    expect(open.reduce((sum, t) => sum + t.bag_count, 0)).toBe(13);
    for (const role of ['citizen', 'volunteer', 'organizer']) {
      await expect(
        asActor(db, user(role), `select * from open_pickup_tasks($1)`, [tenant]),
      ).rejects.toMatchObject({ code: '42501' });
    }
    // The municipality admin and the super admin are staff too.
    for (const role of ['municipality_admin', 'super_admin']) {
      expect(
        await asActor(db, user(role), `select * from open_pickup_tasks($1)`, [tenant]),
      ).toHaveLength(5);
    }
  });

  it('roles behave as in real use: claim rules and own reports', async () => {
    const find = async (comment: string) =>
      (
        await db.query<{ id: string; tenant_id: string; is_hazardous: boolean }>(
          `select id, tenant_id, is_hazardous from public.reports where comment like $1`,
          [`[Demo] ${comment}%`],
        )
      ).rows[0]!;
    const hazard = await find('Kanister');
    const normal = await find('Alte Matratze');
    const can = async (role: string, report: typeof normal) =>
      (
        await asActor<{ ok: boolean }>(db, user(role), `select can_work_on_report($1, $2) as ok`, [
          report.tenant_id,
          report.is_hazardous,
        ])
      )[0]!.ok;
    expect(await can('volunteer', normal)).toBe(true);
    expect(await can('volunteer', hazard)).toBe(false);
    expect(await can('municipality_staff', hazard)).toBe(true);
    expect(await can('citizen', normal)).toBe(false);

    const mine = await asActor<{ n: number }>(
      db,
      user('citizen'),
      `select count(*)::int as n from reports_public where reported_by_me`,
    );
    expect(mine[0]!.n).toBeGreaterThan(5);
    // Claiming works on the seeded data through the real function.
    await asActor(db, user('volunteer'), `select claim_report($1)`, [normal.id]);
  });

  it('public statistics include the demo data', async () => {
    const [stats] = await asActor<{ s: Record<string, number> }>(
      db,
      { sub: null },
      `select public_stats() as s`,
    );
    expect(stats!.s).toMatchObject({ municipalities: 1, cleared: 11 });
    expect(stats!.s.kg_cleared).toBeGreaterThan(0);
  });

  it('remove.sql deletes the demo data and nothing else', async () => {
    // A report a demo user made during a demo is demo data as well.
    await asActor(db, user('citizen'), `select submit_report($1, 9.95, 53.55, 'plastic', 'bag')`, [
      randomUUID(),
    ]);
    await db.exec(REMOVE);
    const { rows } = await db.query<{ reports: number; tenants: number; members: number }>(
      `select (select count(*)::int from public.reports) as reports,
              (select count(*)::int from public.tenants where kind = 'municipality') as tenants,
              (select count(*)::int from public.memberships) as members`,
    );
    expect(rows[0]).toEqual({ reports: 1, tenants: 0, members: 0 });
  });
});
