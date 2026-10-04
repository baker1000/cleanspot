// @vitest-environment node
// Migration 7: bag pickup tasks (report_bags, collect_pickup, cancel_pickup, open_pickup_tasks).
import { randomUUID } from 'node:crypto';
import { asActor, createTestDb, createUser, type Actor, type Db } from './harness';

const REPORTER = '20000000-0000-4000-8000-000000000001';
const VOL = '20000000-0000-4000-8000-000000000002';
const VOL2 = '20000000-0000-4000-8000-000000000003';
const STAFF = '20000000-0000-4000-8000-000000000004';
const STAFF_OTHER = '20000000-0000-4000-8000-000000000005';

const HARBURG_AREA =
  'MULTIPOLYGON(((9.60 53.15, 10.35 53.15, 10.35 53.48, 9.60 53.48, 9.60 53.15)))';
const OTHER_AREA =
  'MULTIPOLYGON(((11.00 52.00, 11.50 52.00, 11.50 52.50, 11.00 52.50, 11.00 52.00)))';
const M_PER_DEG_LAT = 111_320;
const north = (lat: number, metres: number) => lat + metres / M_PER_DEG_LAT;

const as = (sub: string | null, anonymous = false): Actor => ({ sub, anonymous });
const code = (c: string) => expect.objectContaining({ code: c });

let db: Db;
let harburg: string;

let spot = 0;
/** Inside Landkreis Harburg by default; `public` = outside every municipality. */
function nextSpot(area: 'harburg' | 'public' = 'harburg') {
  spot += 1;
  return area === 'harburg'
    ? { lng: 9.7 + spot * 0.01, lat: 53.25 }
    : { lng: 8.0 + spot * 0.01, lat: 54.5 };
}

const rpc = <T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []) =>
  asActor<T>(db, actor, sql, params, { commit: true });

async function upload(uid: string) {
  const path = `${uid}/${randomUUID()}.webp`;
  await rpc(
    as(uid),
    `insert into storage.objects (bucket_id, name, owner) values ('report-photos', $1, $2)`,
    [path, uid],
  );
  return path;
}

/** A report cleared by `by` (a volunteer of the public tenant, or staff). */
async function clearedReport(by = VOL, area: 'harburg' | 'public' = 'harburg') {
  const s = nextSpot(area);
  const [row] = await rpc<{ id: string }>(
    as(REPORTER),
    `select submit_report($1, $2, $3, 'mixed', 'pile') as id`,
    [randomUUID(), s.lng, s.lat],
  );
  await rpc(as(by), `select submit_cleanup($1, $2, $3, $4)`, [
    row!.id,
    await upload(by),
    s.lng,
    s.lat,
  ]);
  return { id: row!.id, ...s };
}

const reportBags = (
  actor: Actor,
  r: { id: string; lng: number; lat: number },
  bags: number,
  path: string,
  metres = 20,
) =>
  rpc<{ id: string }>(actor, `select report_bags($1, $2, $3, $4, $5) as id`, [
    r.id,
    bags,
    path,
    r.lng,
    north(r.lat, metres),
  ]).then((rows) => rows[0]!.id);

async function task(id: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    `select * from pickup_tasks where id = $1`,
    [id],
  );
  return rows[0]!;
}

async function reportKg(id: string) {
  const { rows } = await db.query<{ kg: string }>(
    `select estimated_kg as kg from reports where id = $1`,
    [id],
  );
  return Number(rows[0]!.kg);
}

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [REPORTER, VOL, VOL2, STAFF, STAFF_OTHER]) await createUser(db, id);
  const { rows } = await db.query<{ id: string; slug: string }>(
    `insert into tenants (slug, name, kind, area) values
       ('public', 'CleanSpot Community', 'public', null),
       ('lk-harburg-p', 'Landkreis Harburg', 'municipality', $1::geography),
       ('other-p', 'Other Town', 'municipality', $2::geography)
     on conflict (kind) where kind = 'public' do update set slug = excluded.slug, settings = excluded.settings
     returning id, slug`,
    [HARBURG_AREA, OTHER_AREA],
  );
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  harburg = bySlug['lk-harburg-p']!;
  await db.query(
    `insert into memberships (user_id, tenant_id, role) values
       ($1, $5, 'volunteer'), ($2, $5, 'volunteer'),
       ($3, $6, 'municipality_staff'), ($4, $7, 'municipality_staff')`,
    [VOL, VOL2, STAFF, STAFF_OTHER, bySlug.public, harburg, bySlug['other-p']],
  );
  await db.query(`update tenants set settings = '{"reports_per_hour_registered": 1000}'`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('report_bags', () => {
  it('creates a pickup task with photo, kg estimate and a timeline event', async () => {
    const r = await clearedReport();
    const path = await upload(VOL);
    const id = await reportBags(as(VOL), r, 4, path, 120);

    const t = await task(id);
    expect(t).toMatchObject({
      report_id: r.id,
      tenant_id: harburg,
      bag_count: 4,
      status: 'open',
      created_by: VOL,
    });
    expect(Number(t.estimated_kg)).toBe(24); // 4 × kg_per_bag 6
    expect(Number(t.distance_to_report_m)).toBeGreaterThan(115);
    expect(await reportKg(r.id)).toBe(24); // replaces the size estimate (pile 40)

    const photo = await db.query<Record<string, unknown>>(
      `select kind, moderation from report_photos where id = $1`,
      [t.photo_id],
    );
    expect(photo.rows[0]).toEqual({ kind: 'bags', moderation: 'pending' });
    const events = await db.query<{ type: string; data: { bags: number } }>(
      `select type, data from report_events where report_id = $1 order by created_at, id`,
      [r.id],
    );
    expect(events.rows.at(-1)).toMatchObject({ type: 'bags_reported', data: { bags: 4 } });
  });

  it('several drops add up', async () => {
    const r = await clearedReport();
    await reportBags(as(VOL), r, 2, await upload(VOL));
    await reportBags(as(VOL), r, 3, await upload(VOL), 60);
    expect(await reportKg(r.id)).toBe(30);
  });

  it('only for cleared reports (CS001)', async () => {
    const s = nextSpot();
    const [row] = await rpc<{ id: string }>(
      as(REPORTER),
      `select submit_report($1, $2, $3, 'mixed', 'pile') as id`,
      [randomUUID(), s.lng, s.lat],
    );
    await expect(reportBags(as(VOL), { id: row!.id, ...s }, 2, await upload(VOL))).rejects.toEqual(
      code('CS001'),
    );
  });

  it('only the person who cleared it, or staff (42501)', async () => {
    const r = await clearedReport();
    await expect(reportBags(as(VOL2), r, 2, await upload(VOL2))).rejects.toEqual(code('42501'));
    await expect(reportBags(as(REPORTER), r, 2, await upload(REPORTER))).rejects.toEqual(
      code('42501'),
    );
    await expect(reportBags(as(STAFF), r, 2, await upload(STAFF))).resolves.toBeTruthy();
  });

  it('no pickup service outside the municipalities (CS010)', async () => {
    const r = await clearedReport(VOL, 'public');
    await expect(reportBags(as(VOL), r, 2, await upload(VOL))).rejects.toEqual(code('CS010'));
  });

  it('validates the number of bags and the distance (300 m)', async () => {
    const r = await clearedReport();
    await expect(reportBags(as(VOL), r, 0, await upload(VOL))).rejects.toEqual(code('CS007'));
    await expect(reportBags(as(VOL), r, 31, await upload(VOL))).rejects.toEqual(code('CS007'));
    await expect(reportBags(as(VOL), r, 2, await upload(VOL), 350)).rejects.toEqual(code('CS002'));
  });

  it('anonymous visitors (anon role) cannot call it', async () => {
    const r = await clearedReport();
    await expect(reportBags(as(null), r, 2, 'x')).rejects.toThrow(/permission denied/);
  });
});

describe('pickup tasks for staff', () => {
  it('RLS: the creator and the tenant staff see a task; others do not', async () => {
    const r = await clearedReport();
    const id = await reportBags(as(VOL), r, 2, await upload(VOL));
    const visible = async (actor: Actor) =>
      (await rpc(actor, `select id from pickup_tasks where id = $1`, [id])).length;
    expect(await visible(as(VOL))).toBe(1);
    expect(await visible(as(STAFF))).toBe(1);
    expect(await visible(as(STAFF_OTHER))).toBe(0);
    expect(await visible(as(VOL2))).toBe(0);
    await expect(visible(as(null))).rejects.toThrow(/permission denied/);
    // No direct writes.
    await expect(
      rpc(as(STAFF), `update pickup_tasks set status = 'collected' where id = $1`, [id]),
    ).rejects.toThrow(/permission denied/);
  });

  it('open_pickup_tasks: staff of the tenant only, with coordinates and photo path', async () => {
    const r = await clearedReport();
    const path = await upload(VOL);
    const id = await reportBags(as(VOL), r, 5, path, 30);

    const rows = await rpc<Record<string, unknown>>(
      as(STAFF),
      `select * from open_pickup_tasks($1)`,
      [harburg],
    );
    const row = rows.find((x) => x.id === id)!;
    expect(row).toMatchObject({
      report_id: r.id,
      bag_count: 5,
      photo_path: path,
      category: 'mixed',
    });
    expect(row.lng).toBeCloseTo(r.lng, 6);
    expect(row.lat).toBeCloseTo(north(r.lat, 30), 6);

    await expect(
      rpc(as(STAFF_OTHER), `select * from open_pickup_tasks($1)`, [harburg]),
    ).rejects.toEqual(code('42501'));
    await expect(rpc(as(VOL), `select * from open_pickup_tasks($1)`, [harburg])).rejects.toEqual(
      code('42501'),
    );
  });

  it('collect_pickup: staff only, once; logs bags_collected; leaves the open list', async () => {
    const r = await clearedReport();
    const id = await reportBags(as(VOL), r, 3, await upload(VOL));

    await expect(rpc(as(VOL), `select collect_pickup($1)`, [id])).rejects.toEqual(code('42501'));
    await expect(rpc(as(STAFF_OTHER), `select collect_pickup($1)`, [id])).rejects.toEqual(
      code('42501'),
    );
    await rpc(as(STAFF), `select collect_pickup($1)`, [id]);
    expect(await task(id)).toMatchObject({ status: 'collected', collected_by: STAFF });
    await expect(rpc(as(STAFF), `select collect_pickup($1)`, [id])).rejects.toEqual(code('CS001'));

    const open = await rpc<{ id: string }>(as(STAFF), `select id from open_pickup_tasks($1)`, [
      harburg,
    ]);
    expect(open.map((o) => o.id)).not.toContain(id);
    const events = await db.query<{ type: string }>(
      `select type from report_events where report_id = $1 order by created_at, id`,
      [r.id],
    );
    expect(events.rows.at(-1)!.type).toBe('bags_collected');
    expect(await reportKg(r.id)).toBe(18); // collected bags still count
  });

  it('cancel_pickup: the creator while open, or staff; kg falls back to the size', async () => {
    const r = await clearedReport();
    const id = await reportBags(as(VOL), r, 3, await upload(VOL));
    await expect(rpc(as(VOL2), `select cancel_pickup($1)`, [id])).rejects.toEqual(code('42501'));
    await rpc(as(VOL), `select cancel_pickup($1)`, [id]);
    expect((await task(id)).status).toBe('cancelled');
    expect(await reportKg(r.id)).toBe(40); // pile
    await expect(rpc(as(VOL), `select cancel_pickup($1)`, [id])).rejects.toEqual(code('CS001'));
  });
});
