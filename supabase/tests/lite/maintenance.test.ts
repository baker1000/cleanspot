// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { asActor, createTestDb, createUser, type Actor, type Db } from './harness';

const REPORTER = '20000000-0000-4000-8000-000000000001';
const VOL = '20000000-0000-4000-8000-000000000002';
const CITIZEN = '20000000-0000-4000-8000-000000000003';

const HARBURG_AREA =
  'MULTIPOLYGON(((9.60 53.15, 10.35 53.15, 10.35 53.48, 9.60 53.48, 9.60 53.15)))';
const SERVICE: Actor = { sub: null, role: 'service_role' };

let db: Db;
let harburg: string;
let spot = 0;

const rpc = <T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []) =>
  asActor<T>(db, actor, sql, params, { commit: true });

async function claimedReport(
  hoursAgo: number,
  opts: { confirmed?: boolean; hamburg?: boolean } = {},
) {
  spot += 1;
  const [lng, lat] = opts.hamburg ? [9.99 + spot * 0.001, 53.55] : [9.7 + spot * 0.01, 53.3];
  const [row] = await rpc<{ id: string }>(
    { sub: REPORTER },
    `select submit_report($1, $2, $3, 'mixed', 'bag') as id`,
    [randomUUID(), lng, lat],
  );
  const id = row!.id;
  if (opts.confirmed) await rpc({ sub: CITIZEN }, `select confirm_report($1)`, [id]);
  await rpc({ sub: VOL }, `select claim_report($1)`, [id]);
  await db.query(
    `update reports set claimed_at = now() - make_interval(hours => $2) where id = $1`,
    [id, hoursAgo],
  );
  return id;
}

const reportState = async (id: string) =>
  (
    await db.query<{ status: string; claimed_by: string | null }>(
      `select status, claimed_by from reports where id = $1`,
      [id],
    )
  ).rows[0]!;

async function putObject(name: string, ageHours: number, bucket = 'report-photos') {
  if (bucket !== 'report-photos') {
    await db.query(
      `insert into storage.buckets (id, name) values ($1, $1) on conflict do nothing`,
      [bucket],
    );
  }
  await db.query(
    `insert into storage.objects (bucket_id, name, created_at)
     values ($1, $2, now() - make_interval(hours => $3))`,
    [bucket, name, ageHours],
  );
}

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [REPORTER, VOL, CITIZEN]) await createUser(db, id);
  const { rows } = await db.query<{ id: string; slug: string }>(
    `insert into tenants (slug, name, kind, area, settings) values
       ('public', 'CleanSpot Community', 'public', null, '{"reports_per_hour_registered": 1000}'),
       ('lk-harburg', 'Landkreis Harburg', 'municipality', $1::geography, '{"reports_per_hour_registered": 1000}')
     returning id, slug`,
    [HARBURG_AREA],
  );
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  harburg = bySlug['lk-harburg']!;
  await db.query(
    `insert into memberships (user_id, tenant_id, role) values ($1, $2, 'volunteer')`,
    [VOL, bySlug.public],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('expire_stale_claims', () => {
  it('releases claims older than 72 h, keeps newer ones, logs an expired event', async () => {
    const stale = await claimedReport(73);
    const staleConfirmed = await claimedReport(80, { confirmed: true });
    const fresh = await claimedReport(71);

    const [res] = await rpc<{ n: number }>(SERVICE, `select expire_stale_claims() as n`);
    expect(res!.n).toBeGreaterThanOrEqual(2);

    expect(await reportState(stale)).toEqual({ status: 'reported', claimed_by: null });
    expect(await reportState(staleConfirmed)).toEqual({ status: 'confirmed', claimed_by: null });
    expect(await reportState(fresh)).toEqual({ status: 'in_progress', claimed_by: VOL });

    const ev = await db.query(
      `select actor_id, from_status, to_status, data from report_events
       where report_id = $1 and type = 'unclaimed'`,
      [stale],
    );
    expect(ev.rows).toEqual([
      {
        actor_id: null,
        from_status: 'in_progress',
        to_status: 'reported',
        data: { reason: 'expired' },
      },
    ]);
  });

  it('uses the tenant claim_expiry_hours setting', async () => {
    await db.query(
      `update tenants set settings = settings || '{"claim_expiry_hours": 24}' where id = $1`,
      [harburg],
    );
    try {
      const inHarburg = await claimedReport(30);
      const inPublic = await claimedReport(30, { hamburg: true });
      await rpc(SERVICE, `select expire_stale_claims()`);
      expect((await reportState(inHarburg)).status).toBe('reported');
      expect((await reportState(inPublic)).status).toBe('in_progress');
    } finally {
      await db.query(
        `update tenants set settings = settings - 'claim_expiry_hours' where id = $1`,
        [harburg],
      );
    }
  });

  it('is not callable by API users', async () => {
    await expect(rpc({ sub: VOL }, `select expire_stale_claims()`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(rpc({ sub: null }, `select expire_stale_claims()`)).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('orphan_photo_paths', () => {
  it('lists old unattached photos only', async () => {
    const oldOrphan = `${REPORTER}/${randomUUID()}.webp`;
    const freshOrphan = `${REPORTER}/${randomUUID()}.webp`;
    const attached = `${REPORTER}/${randomUUID()}.webp`;
    const otherBucket = `${REPORTER}/${randomUUID()}.webp`;
    await putObject(oldOrphan, 30);
    await putObject(freshOrphan, 2);
    await putObject(attached, 30);
    await putObject(otherBucket, 30, 'avatars');

    const [r] = await rpc<{ id: string }>(
      { sub: REPORTER },
      `select submit_report($1, 9.65, 53.2, 'mixed', 'bag') as id`,
      [randomUUID()],
    );
    await rpc({ sub: REPORTER }, `select add_report_photo($1, $2)`, [r!.id, attached]);

    const rows = await rpc<{ p: string }>(SERVICE, `select orphan_photo_paths() as p`);
    const paths = rows.map((x) => x.p);
    expect(paths).toContain(oldOrphan);
    expect(paths).not.toContain(freshOrphan);
    expect(paths).not.toContain(attached);
    expect(paths).not.toContain(otherBucket);
  });

  it('is not callable by API users', async () => {
    await expect(rpc({ sub: REPORTER }, `select orphan_photo_paths()`)).rejects.toThrow(
      /permission denied/,
    );
  });
});
