// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { asActor, createTestDb, createUser, type Actor, type Db } from './harness';

const REPORTER = '10000000-0000-4000-8000-000000000001';
const ANON = '10000000-0000-4000-8000-000000000002';
const VOL = '10000000-0000-4000-8000-000000000003';
const VOL2 = '10000000-0000-4000-8000-000000000004';
const CITIZEN = '10000000-0000-4000-8000-000000000005';
const STAFF = '10000000-0000-4000-8000-000000000006';
const STAFF_OTHER = '10000000-0000-4000-8000-000000000007';
const BLOCKED = '10000000-0000-4000-8000-000000000008';
const C2 = '10000000-0000-4000-8000-000000000009';
const C3 = '10000000-0000-4000-8000-00000000000a';

const HARBURG_AREA =
  'MULTIPOLYGON(((9.60 53.15, 10.35 53.15, 10.35 53.48, 9.60 53.48, 9.60 53.15)))';
const OTHER_AREA =
  'MULTIPOLYGON(((11.00 52.00, 11.50 52.00, 11.50 52.50, 11.00 52.50, 11.00 52.00)))';

// ~11.1 m per 0.0001° latitude.
const M_PER_DEG_LAT = 111_320;
const north = (lat: number, metres: number) => lat + metres / M_PER_DEG_LAT;

const as = (sub: string | null, anonymous = false): Actor => ({ sub, anonymous });
const reporter = as(REPORTER);

let db: Db;
let harburg: string;
let publicTenant: string;

/** Each report gets its own spot ~700 m apart so tests don't see each other as duplicates. */
let spot = 0;
function nextSpot() {
  spot += 1;
  return { lng: 9.7 + spot * 0.01, lat: 53.3 };
}

/** Runs an RPC as the actor and commits. */
async function rpc<T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []) {
  return asActor<T>(db, actor, sql, params, { commit: true });
}

async function newReport(
  actor: Actor = reporter,
  opts: {
    lng?: number;
    lat?: number;
    category?: string;
    hazard?: string | null;
    comment?: string;
  } = {},
) {
  const s = nextSpot();
  const [row] = await rpc<{ id: string }>(
    actor,
    `select submit_report($1, $2, $3, $4, 'pile', $5, $6) as id`,
    [
      randomUUID(),
      opts.lng ?? s.lng,
      opts.lat ?? s.lat,
      opts.category ?? 'mixed',
      opts.hazard ?? null,
      opts.comment ?? null,
    ],
  );
  return { id: row!.id, lng: opts.lng ?? s.lng, lat: opts.lat ?? s.lat };
}

/** Uploads a fake object into the actor's own folder (through the storage RLS policy). */
async function upload(uid: string) {
  const path = `${uid}/${randomUUID()}.webp`;
  await rpc(
    as(uid),
    `insert into storage.objects (bucket_id, name, owner) values ('report-photos', $1, $2)`,
    [path, uid],
  );
  return path;
}

async function status(id: string) {
  const { rows } = await db.query<{ status: string }>(`select status from reports where id = $1`, [
    id,
  ]);
  return rows[0]!.status;
}

const code = (c: string) => expect.objectContaining({ code: c });

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [REPORTER, VOL, VOL2, CITIZEN, STAFF, STAFF_OTHER, BLOCKED, C2, C3]) {
    await createUser(db, id);
  }
  await createUser(db, ANON, { anonymous: true });
  await db.query(`update profiles set blocked_until = now() + interval '1 day' where id = $1`, [
    BLOCKED,
  ]);

  const { rows } = await db.query<{ id: string; slug: string }>(
    `insert into tenants (slug, name, kind, area) values
       ('public', 'CleanSpot Community', 'public', null),
       ('lk-harburg', 'Landkreis Harburg', 'municipality', $1::geography),
       ('other', 'Other Town', 'municipality', $2::geography)
     on conflict (kind) where kind = 'public' do update set slug = excluded.slug, settings = excluded.settings
     returning id, slug`,
    [HARBURG_AREA, OTHER_AREA],
  );
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  publicTenant = bySlug.public!;
  harburg = bySlug['lk-harburg']!;

  await db.query(
    `insert into memberships (user_id, tenant_id, role) values
       ($1, $5, 'volunteer'), ($2, $5, 'volunteer'),
       ($3, $6, 'municipality_staff'), ($4, $7, 'municipality_staff')`,
    [VOL, VOL2, STAFF, STAFF_OTHER, publicTenant, harburg, bySlug.other],
  );
  // The shared REPORTER creates many reports; keep the registered limit out of the way.
  await db.query(`update tenants set settings = '{"reports_per_hour_registered": 1000}'`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('submit_report', () => {
  it('requires a session (anon role without sign-in is rejected)', async () => {
    await expect(
      rpc(as(null), `select submit_report($1, 9.9, 53.3, 'mixed', 'bag')`, [randomUUID()]),
    ).rejects.toThrow(/permission denied/);
  });

  it('routes to the tenant, estimates kg, starts unpublished and logs a timeline event', async () => {
    const { id } = await newReport(reporter, { comment: '  Sofa am Waldrand  ' });
    const { rows } = await db.query<Record<string, unknown>>(
      `select * from reports where id = $1`,
      [id],
    );
    const r = rows[0]!;
    expect(r.tenant_id).toBe(harburg);
    expect(r.reporter_id).toBe(REPORTER);
    expect(r.status).toBe('reported');
    expect(r.is_published).toBe(false);
    expect(Number(r.estimated_kg)).toBe(40);
    expect(r.comment).toBe('Sofa am Waldrand');
    const events = await db.query(`select type from report_events where report_id = $1`, [id]);
    expect(events.rows).toEqual([{ type: 'created' }]);
  });

  it('is idempotent per client_id for the same user', async () => {
    const clientId = randomUUID();
    const sql = `select submit_report($1, 9.95, 53.2, 'plastic', 'bag') as id`;
    const [a] = await rpc<{ id: string }>(reporter, sql, [clientId]);
    const [b] = await rpc<{ id: string }>(reporter, sql, [clientId]);
    expect(a!.id).toBe(b!.id);
    await expect(rpc(as(CITIZEN), sql, [clientId])).rejects.toEqual(code('CS007'));
  });

  it('normalises hazard_type to the category', async () => {
    const plain = await newReport(reporter, { category: 'plastic', hazard: 'needles' });
    const hazardous = await newReport(reporter, { category: 'hazardous' });
    const { rows } = await db.query<{
      id: string;
      hazard_type: string | null;
      is_hazardous: boolean;
    }>(`select id, hazard_type, is_hazardous from reports where id = any($1)`, [
      [plain.id, hazardous.id],
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[plain.id]).toMatchObject({ hazard_type: null, is_hazardous: false });
    expect(byId[hazardous.id]).toMatchObject({ hazard_type: 'other', is_hazardous: true });
  });

  it('rate-limits anonymous reporters', async () => {
    for (let i = 0; i < 5; i++) await newReport(as(ANON, true));
    await expect(newReport(as(ANON, true))).rejects.toEqual(code('PT429'));
  });

  it('rejects blocked users and invalid coordinates', async () => {
    await expect(newReport(as(BLOCKED))).rejects.toEqual(code('42501'));
    await expect(newReport(reporter, { lng: 200, lat: 53 })).rejects.toEqual(code('CS007'));
  });

  it('clients cannot write the reports table directly', async () => {
    await expect(
      rpc(reporter, `update reports set status = 'cleared' where reporter_id = $1`, [REPORTER]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      rpc(
        reporter,
        `insert into reports (client_id, tenant_id, location, category, size)
         values ($1, $2, 'POINT(9.9 53.3)', 'mixed', 'bag')`,
        [randomUUID(), harburg],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('read access', () => {
  it('anon sees reports_public without personal data; comment hidden until published', async () => {
    const { id } = await newReport(reporter, { comment: 'Hinter der Scheune' });
    const [row] = await rpc<Record<string, unknown>>(
      as(null),
      `select * from reports_public where id = $1`,
      [id],
    );
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('reporter_id');
    expect(row!.comment).toBeNull();
    expect(row!.reported_by_me).toBe(false);
    expect(typeof row!.lng).toBe('number');
  });

  it('the reporter sees reported_by_me', async () => {
    const { id } = await newReport(reporter);
    const [row] = await rpc<{ reported_by_me: boolean }>(
      reporter,
      `select reported_by_me from reports_public where id = $1`,
      [id],
    );
    expect(row!.reported_by_me).toBe(true);
  });

  it('base table: anon denied, other citizens see nothing, staff see their tenant only', async () => {
    const { id } = await newReport(reporter);
    await expect(rpc(as(null), `select id from reports`)).rejects.toThrow(/permission denied/);
    expect(await rpc(as(CITIZEN), `select id from reports where id = $1`, [id])).toHaveLength(0);
    expect(await rpc(reporter, `select id from reports where id = $1`, [id])).toHaveLength(1);
    expect(await rpc(as(STAFF), `select id from reports where id = $1`, [id])).toHaveLength(1);
    expect(await rpc(as(STAFF_OTHER), `select id from reports where id = $1`, [id])).toHaveLength(
      0,
    );
  });

  it('reports_in_bbox returns reports in the box and filters by status', async () => {
    const r = await newReport(reporter);
    const box = [r.lng - 0.001, r.lat - 0.001, r.lng + 0.001, r.lat + 0.001];
    const all = await rpc<{ id: string }>(
      as(null),
      `select id from reports_in_bbox($1, $2, $3, $4)`,
      box,
    );
    expect(all.map((x) => x.id)).toContain(r.id);
    const cleared = await rpc(
      as(null),
      `select id from reports_in_bbox($1, $2, $3, $4, array['cleared']::report_status[])`,
      box,
    );
    expect(cleared).toHaveLength(0);
  });

  it('reports_in_bbox filters by category', async () => {
    const r = await newReport(reporter, { category: 'electronics' });
    const box = [r.lng - 0.001, r.lat - 0.001, r.lng + 0.001, r.lat + 0.001];
    const electronics = await rpc<{ id: string }>(
      as(null),
      `select id from reports_in_bbox($1, $2, $3, $4, p_categories => array['electronics']::report_category[])`,
      box,
    );
    expect(electronics.map((x) => x.id)).toEqual([r.id]);
    const bulky = await rpc(
      as(null),
      `select id from reports_in_bbox($1, $2, $3, $4, p_categories => array['bulky']::report_category[])`,
      box,
    );
    expect(bulky).toHaveLength(0);
  });

  it('reports_in_bbox is an exact lng/lat rectangle (edges inclusive)', async () => {
    const r = await newReport(reporter);
    const ids = async (box: number[]) =>
      (
        await rpc<{ id: string }>(as(null), `select id from reports_in_bbox($1, $2, $3, $4)`, box)
      ).map((x) => x.id);
    // Point exactly on the west/south edge: inside.
    expect(await ids([r.lng, r.lat, r.lng + 0.01, r.lat + 0.01])).toContain(r.id);
    // Box ending 1 m short of the point (east and north): outside.
    expect(await ids([r.lng - 0.01, r.lat - 0.01, r.lng - 0.00001, r.lat + 0.01])).not.toContain(
      r.id,
    );
    expect(await ids([r.lng - 0.01, r.lat - 0.01, r.lng + 0.01, r.lat - 0.00001])).not.toContain(
      r.id,
    );
    // A wide viewport (whole of northern Germany) still finds it near its southern edge.
    expect(await ids([5, r.lat - 0.00001, 15, 56])).toContain(r.id);
  });

  it('the bbox filter used by reports_in_bbox can use the spatial index', async () => {
    // reports_in_bbox has SET search_path, so it is not inlined and EXPLAIN cannot see inside it.
    // This checks the same predicate against the base table.
    await db.query(`set enable_seqscan = off`);
    try {
      const { rows } = await db.query<{ 'QUERY PLAN': string }>(
        `explain select id from public.reports r
         where (r.location::extensions.geometry) operator(extensions.&&)
               extensions.st_makeenvelope(9, 53, 10, 54, 4326)`,
      );
      expect(rows.map((x) => x['QUERY PLAN']).join('\n')).toContain('reports_location_geom_gix');
    } finally {
      await db.query(`reset enable_seqscan`);
    }
  });

  it('public timeline is visible to anon, base events are not', async () => {
    const { id } = await newReport(reporter);
    const events = await rpc(
      as(null),
      `select type from report_events_public where report_id = $1`,
      [id],
    );
    expect(events).toEqual([{ type: 'created' }]);
    await expect(rpc(as(null), `select id from report_events`)).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('duplicate detection', () => {
  it('finds open reports within 30 m, not at 60 m, and ignores cleared ones', async () => {
    const r = await newReport(reporter);
    const near = await rpc<{ id: string; distance_m: number }>(
      as(null),
      `select id, distance_m from find_nearby_open_reports($1, $2)`,
      [r.lng, north(r.lat, 20)],
    );
    expect(near.map((x) => x.id)).toContain(r.id);
    expect(near[0]!.distance_m).toBeGreaterThan(15);
    expect(near[0]!.distance_m).toBeLessThan(25);

    const far = await rpc(as(null), `select id from find_nearby_open_reports($1, $2)`, [
      r.lng,
      north(r.lat, 60),
    ]);
    expect(far).toHaveLength(0);

    await rpc(as(STAFF), `select set_report_status($1, 'cleared')`, [r.id]);
    const afterClear = await rpc(as(null), `select id from find_nearby_open_reports($1, $2)`, [
      r.lng,
      r.lat,
    ]);
    expect(afterClear).toHaveLength(0);
  });
});

describe('confirmations and auto-publish', () => {
  it('reporter and anonymous users cannot confirm', async () => {
    const { id } = await newReport(reporter);
    await expect(rpc(reporter, `select confirm_report($1)`, [id])).rejects.toEqual(code('CS008'));
    await expect(rpc(as(ANON, true), `select confirm_report($1)`, [id])).rejects.toEqual(
      code('CS008'),
    );
  });

  it('first confirmation sets status confirmed; repeat is idempotent', async () => {
    const { id } = await newReport(reporter);
    const [a] = await rpc<{ n: number }>(as(CITIZEN), `select confirm_report($1) as n`, [id]);
    const [b] = await rpc<{ n: number }>(as(CITIZEN), `select confirm_report($1) as n`, [id]);
    expect(a!.n).toBe(1);
    expect(b!.n).toBe(1);
    expect(await status(id)).toBe('confirmed');
  });

  it('after N (=3) confirmations pending before-photos are approved and the report is published', async () => {
    const { id } = await newReport(reporter, { comment: 'Bauschutt' });
    const path = await upload(REPORTER);
    await rpc(reporter, `select add_report_photo($1, $2)`, [id, path]);

    // Pending photo: not public, not readable by anon via storage.
    expect(
      await rpc(as(null), `select id from report_photos_public where report_id = $1`, [id]),
    ).toHaveLength(0);
    expect(
      await rpc(as(null), `select name from storage.objects where name = $1`, [path]),
    ).toHaveLength(0);

    for (const u of [CITIZEN, C2, C3]) await rpc(as(u), `select confirm_report($1)`, [id]);

    const [pub] = await rpc<{ comment: string; is_published: boolean }>(
      as(null),
      `select comment, is_published from reports_public where id = $1`,
      [id],
    );
    expect(pub).toMatchObject({ comment: 'Bauschutt', is_published: true });
    expect(
      await rpc(as(null), `select id from report_photos_public where report_id = $1`, [id]),
    ).toHaveLength(1);
    expect(
      await rpc(as(null), `select name from storage.objects where name = $1`, [path]),
    ).toHaveLength(1);
  });
});

describe('photos and storage', () => {
  it('uploads only into the own folder', async () => {
    await expect(
      rpc(
        as(CITIZEN),
        `insert into storage.objects (bucket_id, name, owner) values ('report-photos', $1, $2)`,
        [`${REPORTER}/${randomUUID()}.webp`, CITIZEN],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('blocked users cannot upload', async () => {
    await expect(upload(BLOCKED)).rejects.toThrow(/row-level security/);
  });

  it('attach requires an uploaded object in the own folder, max 3 before-photos, reporter only', async () => {
    const { id } = await newReport(reporter);
    const missing = `${REPORTER}/${randomUUID()}.webp`;
    await expect(rpc(reporter, `select add_report_photo($1, $2)`, [id, missing])).rejects.toEqual(
      code('CS005'),
    );

    const foreign = await upload(CITIZEN);
    await expect(rpc(reporter, `select add_report_photo($1, $2)`, [id, foreign])).rejects.toEqual(
      code('CS005'),
    );
    await expect(
      rpc(as(CITIZEN), `select add_report_photo($1, $2)`, [id, foreign]),
    ).rejects.toEqual(code('42501'));

    for (let i = 0; i < 3; i++) {
      await rpc(reporter, `select add_report_photo($1, $2)`, [id, await upload(REPORTER)]);
    }
    await expect(
      rpc(reporter, `select add_report_photo($1, $2)`, [id, await upload(REPORTER)]),
    ).rejects.toEqual(code('CS006'));
  });

  it('staff review: approving a before-photo publishes; rejected photos stay hidden', async () => {
    const { id } = await newReport(reporter);
    const p1 = await upload(REPORTER);
    const p2 = await upload(REPORTER);
    await rpc(reporter, `select add_report_photo($1, $2)`, [id, p1]);
    await rpc(reporter, `select add_report_photo($1, $2)`, [id, p2]);
    const photos = await db.query<{ id: string; storage_path: string }>(
      `select id, storage_path from report_photos where report_id = $1`,
      [id],
    );
    const idOf = (p: string) => photos.rows.find((r) => r.storage_path === p)!.id;

    await expect(
      rpc(as(STAFF_OTHER), `select moderate_photo($1, true)`, [idOf(p1)]),
    ).rejects.toEqual(code('42501'));
    await expect(rpc(as(VOL), `select moderate_photo($1, true)`, [idOf(p1)])).rejects.toEqual(
      code('42501'),
    );

    await rpc(as(STAFF), `select moderate_photo($1, false)`, [idOf(p2)]);
    await rpc(as(STAFF), `select moderate_photo($1, true)`, [idOf(p1)]);

    const visible = await rpc<{ storage_path: string }>(
      as(null),
      `select storage_path from report_photos_public where report_id = $1`,
      [id],
    );
    expect(visible.map((v) => v.storage_path)).toEqual([p1]);
    const [r] = await rpc<{ is_published: boolean }>(
      as(null),
      `select is_published from reports_public where id = $1`,
      [id],
    );
    expect(r!.is_published).toBe(true);
  });
});

describe('claim / unclaim', () => {
  it('anonymous users and registered non-volunteers cannot claim', async () => {
    const { id } = await newReport(reporter);
    await expect(rpc(as(ANON, true), `select claim_report($1)`, [id])).rejects.toEqual(
      code('42501'),
    );
    await expect(rpc(as(CITIZEN), `select claim_report($1)`, [id])).rejects.toEqual(code('42501'));
  });

  it('a volunteer claims; others cannot; unclaim restores the previous status', async () => {
    const { id } = await newReport(reporter);
    await rpc(as(CITIZEN), `select confirm_report($1)`, [id]);
    await rpc(as(VOL), `select claim_report($1)`, [id]);
    expect(await status(id)).toBe('in_progress');
    await expect(rpc(as(VOL2), `select claim_report($1)`, [id])).rejects.toEqual(code('CS003'));
    await expect(rpc(as(VOL2), `select unclaim_report($1)`, [id])).rejects.toEqual(code('42501'));
    await rpc(as(VOL), `select unclaim_report($1)`, [id]);
    expect(await status(id)).toBe('confirmed');
  });

  it('hazardous reports cannot be claimed by volunteers, only by staff of the tenant', async () => {
    const { id } = await newReport(reporter, { category: 'hazardous', hazard: 'asbestos' });
    await expect(rpc(as(VOL), `select claim_report($1)`, [id])).rejects.toEqual(code('CS004'));
    await expect(rpc(as(STAFF_OTHER), `select claim_report($1)`, [id])).rejects.toEqual(
      code('CS004'),
    );
    await rpc(as(STAFF), `select claim_report($1)`, [id]);
    expect(await status(id)).toBe('in_progress');
  });

  it('respects allow_volunteer_claims = false', async () => {
    await db.query(
      `update tenants set settings = settings || '{"allow_volunteer_claims": false}' where id = $1`,
      [harburg],
    );
    try {
      const { id } = await newReport(reporter);
      await expect(rpc(as(VOL), `select claim_report($1)`, [id])).rejects.toEqual(code('42501'));
      await rpc(as(STAFF), `select claim_report($1)`, [id]);
    } finally {
      await db.query(
        `update tenants set settings = settings - 'allow_volunteer_claims' where id = $1`,
        [harburg],
      );
    }
  });
});

describe('submit_cleanup (50 m verification)', () => {
  const cleanup = (
    actor: Actor,
    id: string,
    path: string,
    lng: number,
    lat: number,
    takenAt?: string,
  ) =>
    rpc<{ r: { distance_m: number; photo_id: string } }>(
      actor,
      `select submit_cleanup($1, $2, $3, $4, $5) as r`,
      [id, path, lng, lat, takenAt ?? null],
    );

  it('rejects an after-photo taken more than 50 m away', async () => {
    const r = await newReport(reporter);
    const path = await upload(VOL);
    await expect(cleanup(as(VOL), r.id, path, r.lng, north(r.lat, 80))).rejects.toEqual(
      code('CS002'),
    );
    expect(await status(r.id)).toBe('reported');
  });

  it('clears within 50 m, stores distance + timestamp, after-photo pending for volunteers', async () => {
    const r = await newReport(reporter);
    const path = await upload(VOL);
    const [res] = await cleanup(as(VOL), r.id, path, r.lng, north(r.lat, 40));
    expect(res!.r.distance_m).toBeGreaterThan(35);
    expect(res!.r.distance_m).toBeLessThan(45);

    const { rows } = await db.query<Record<string, unknown>>(
      `select * from reports where id = $1`,
      [r.id],
    );
    expect(rows[0]).toMatchObject({ status: 'cleared', cleared_by: VOL, claimed_by: VOL });
    expect(rows[0]!.cleared_at).not.toBeNull();

    const photo = await db.query<Record<string, unknown>>(
      `select * from report_photos where storage_path = $1`,
      [path],
    );
    expect(photo.rows[0]).toMatchObject({ kind: 'after', moderation: 'pending' });
    expect(photo.rows[0]!.taken_at).not.toBeNull();

    const ev = await db.query<{ data: { distance_m: number } }>(
      `select data from report_events where report_id = $1 and type = 'cleared'`,
      [r.id],
    );
    expect(ev.rows[0]!.data.distance_m).toBeGreaterThan(35);
  });

  it('staff after-photos are auto-approved', async () => {
    const r = await newReport(reporter);
    const path = await upload(STAFF);
    await cleanup(as(STAFF), r.id, path, r.lng, r.lat);
    const photo = await db.query(`select moderation from report_photos where storage_path = $1`, [
      path,
    ]);
    expect(photo.rows[0]).toEqual({ moderation: 'approved' });
  });

  it('only the claimer (or staff) can clear a claimed report', async () => {
    const r = await newReport(reporter);
    await rpc(as(VOL), `select claim_report($1)`, [r.id]);
    await expect(cleanup(as(VOL2), r.id, await upload(VOL2), r.lng, r.lat)).rejects.toEqual(
      code('CS003'),
    );
    await cleanup(as(STAFF), r.id, await upload(STAFF), r.lng, r.lat);
    expect(await status(r.id)).toBe('cleared');
  });

  it('volunteers cannot clear hazardous reports', async () => {
    const r = await newReport(reporter, { category: 'hazardous', hazard: 'needles' });
    await expect(cleanup(as(VOL), r.id, await upload(VOL), r.lng, r.lat)).rejects.toEqual(
      code('CS004'),
    );
  });

  it('rejects photo timestamps in the future or before the report existed', async () => {
    const r = await newReport(reporter);
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const past = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    await expect(cleanup(as(VOL), r.id, await upload(VOL), r.lng, r.lat, future)).rejects.toEqual(
      code('CS007'),
    );
    await expect(cleanup(as(VOL), r.id, await upload(VOL), r.lng, r.lat, past)).rejects.toEqual(
      code('CS007'),
    );
  });

  it('cannot clear an already cleared report', async () => {
    const r = await newReport(reporter);
    await cleanup(as(VOL), r.id, await upload(VOL), r.lng, r.lat);
    await expect(cleanup(as(VOL), r.id, await upload(VOL), r.lng, r.lat)).rejects.toEqual(
      code('CS001'),
    );
  });
});

describe('staff status changes', () => {
  it('only staff of the tenant can change status; rejected reports disappear from public views', async () => {
    const { id } = await newReport(reporter);
    await expect(rpc(as(VOL), `select set_report_status($1, 'rejected')`, [id])).rejects.toEqual(
      code('42501'),
    );
    await expect(
      rpc(as(STAFF_OTHER), `select set_report_status($1, 'rejected')`, [id]),
    ).rejects.toEqual(code('42501'));
    await rpc(as(STAFF), `select set_report_status($1, 'rejected', 'Kein Müll erkennbar')`, [id]);
    expect(await rpc(as(null), `select id from reports_public where id = $1`, [id])).toHaveLength(
      0,
    );
    // The reporter still sees their own report and its status.
    expect(await rpc(reporter, `select status from reports where id = $1`, [id])).toEqual([
      { status: 'rejected' },
    ]);
  });

  it('mark_duplicate links to the original and hides the duplicate', async () => {
    const a = await newReport(reporter);
    const b = await newReport(as(CITIZEN));
    await expect(
      rpc(as(STAFF), `select set_report_status($1, 'duplicate')`, [b.id]),
    ).rejects.toEqual(code('CS001'));
    await rpc(as(STAFF), `select mark_duplicate($1, $2)`, [b.id, a.id]);
    const { rows } = await db.query(`select status, duplicate_of from reports where id = $1`, [
      b.id,
    ]);
    expect(rows[0]).toEqual({ status: 'duplicate', duplicate_of: a.id });
    expect(await rpc(as(null), `select id from reports_public where id = $1`, [b.id])).toHaveLength(
      0,
    );
    await expect(rpc(as(STAFF), `select mark_duplicate($1, $2)`, [a.id, b.id])).rejects.toEqual(
      code('CS001'),
    );
  });

  it('reports outside every municipality go to the public tenant', async () => {
    const { id } = await newReport(reporter, { lng: 9.99, lat: 53.55 });
    const { rows } = await db.query(`select tenant_id from reports where id = $1`, [id]);
    expect(rows[0]).toEqual({ tenant_id: publicTenant });
  });
});

describe('remaining read rules', () => {
  it('claimed_by_me is true only for the claimer', async () => {
    const { id } = await newReport(reporter);
    await rpc(as(VOL), `select claim_report($1)`, [id]);
    const sql = `select claimed_by_me, is_claimed from reports_public where id = $1`;
    expect(await rpc(as(VOL), sql, [id])).toEqual([{ claimed_by_me: true, is_claimed: true }]);
    expect(await rpc(as(VOL2), sql, [id])).toEqual([{ claimed_by_me: false, is_claimed: true }]);
  });

  it('report_photos: uploader and tenant staff see rows, others do not', async () => {
    const { id } = await newReport(reporter);
    await rpc(reporter, `select add_report_photo($1, $2)`, [id, await upload(REPORTER)]);
    const sql = `select id from report_photos where report_id = $1`;
    expect(await rpc(reporter, sql, [id])).toHaveLength(1);
    expect(await rpc(as(STAFF), sql, [id])).toHaveLength(1);
    expect(await rpc(as(CITIZEN), sql, [id])).toHaveLength(0);
    expect(await rpc(as(STAFF_OTHER), sql, [id])).toHaveLength(0);
  });

  it('report_confirmations: own rows and tenant staff only', async () => {
    const { id } = await newReport(reporter);
    await rpc(as(CITIZEN), `select confirm_report($1)`, [id]);
    const sql = `select user_id from report_confirmations where report_id = $1`;
    expect(await rpc(as(CITIZEN), sql, [id])).toHaveLength(1);
    expect(await rpc(as(STAFF), sql, [id])).toHaveLength(1);
    expect(await rpc(reporter, sql, [id])).toHaveLength(0);
  });
});

describe('registered rate limit', () => {
  it('applies reports_per_hour_registered', async () => {
    await db.query(
      `update tenants set settings = settings || '{"reports_per_hour_registered": 2}' where id = $1`,
      [harburg],
    );
    try {
      await newReport(as(C3));
      await newReport(as(C3));
      await expect(newReport(as(C3))).rejects.toEqual(code('PT429'));
    } finally {
      await db.query(
        `update tenants set settings = settings || '{"reports_per_hour_registered": 1000}' where id = $1`,
        [harburg],
      );
    }
  });
});

describe('tenant_at_point (migration 6)', () => {
  const sql = `select tenant_id, kind, name, bulky_waste_url from tenant_at_point($1, $2)`;

  it('names the municipality for anon and matches submit_report routing', async () => {
    await db.query(
      `update tenants set settings = settings || '{"bulky_waste_url": "https://example.org/sperrmuell"}' where id = $1`,
      [harburg],
    );
    try {
      const [row] = await rpc(as(null), sql, [10.11, 53.38]);
      expect(row).toEqual({
        tenant_id: harburg,
        kind: 'municipality',
        name: 'Landkreis Harburg',
        bulky_waste_url: 'https://example.org/sperrmuell',
      });
      const { id } = await newReport(reporter, { lng: 10.11, lat: 53.38 });
      const { rows } = await db.query(`select tenant_id from reports where id = $1`, [id]);
      expect(rows[0]).toEqual({ tenant_id: harburg });
    } finally {
      await db.query(`update tenants set settings = settings - 'bulky_waste_url' where id = $1`, [
        harburg,
      ]);
    }
  });

  it('falls back to the public tenant outside every municipality', async () => {
    const [row] = await rpc(as(REPORTER), sql, [-30, 40]);
    expect(row).toEqual(
      expect.objectContaining({ tenant_id: publicTenant, kind: 'public', bulky_waste_url: null }),
    );
  });

  it('rejects invalid coordinates', async () => {
    await expect(rpc(as(null), sql, [200, 40])).rejects.toEqual(code('CS007'));
  });
});
