// @vitest-environment node
// Migration 8: export_my_data, delete_my_photos, delete_my_account, leave_volunteer_role and the
// storage policy for deleting one's own (detached) photo files.
import { randomUUID } from 'node:crypto';
import { asActor, createTestDb, createUser, DB_TARGET, type Actor, type Db } from './harness';

// Real Supabase refuses SQL deletes on storage.objects ("Use the Storage API instead"), so the
// storage delete policy is checked here in PGlite only, and on the cloud through the Storage API
// (tests/remote-api, F10).
const sqlStorageDeletes = DB_TARGET === 'pglite';

const ME = '30000000-0000-4000-8000-000000000001';
const OTHER = '30000000-0000-4000-8000-000000000002';
const STAFF = '30000000-0000-4000-8000-000000000003';
const ANON = '30000000-0000-4000-8000-000000000004';

const HARBURG_AREA =
  'MULTIPOLYGON(((9.60 53.15, 10.35 53.15, 10.35 53.48, 9.60 53.48, 9.60 53.15)))';

const as = (sub: string | null, anonymous = false): Actor => ({ sub, anonymous });
const code = (c: string) => expect.objectContaining({ code: c });

type Row = Record<string, unknown>;
interface Export {
  format: string;
  account: Row;
  profile: Row;
  memberships: Row[];
  reports: (Row & { id: string; lng: number })[];
  photos: { storage_path: string }[];
  confirmations: Row[];
  events: { type: string }[];
  bag_pickups: Row[];
}

let db: Db;
let publicTenant: string;
let harburg: string;

let spot = 0;
/** Harburg (municipality) by default; `public` = outside every municipality. */
function nextSpot(area: 'harburg' | 'public' = 'public') {
  spot += 1;
  return area === 'harburg'
    ? { lng: 9.7 + spot * 0.01, lat: 53.2 }
    : { lng: 8.0 + spot * 0.01, lat: 54.6 };
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

async function report(by: string, opts: { comment?: string; area?: 'harburg' | 'public' } = {}) {
  const s = nextSpot(opts.area);
  const [row] = await rpc<{ id: string }>(
    as(by),
    `select submit_report($1, $2, $3, 'mixed', 'pile', null, $4) as id`,
    [randomUUID(), s.lng, s.lat, opts.comment ?? null],
  );
  const path = await upload(by);
  await rpc(as(by), `select add_report_photo($1, $2)`, [row!.id, path]);
  return { id: row!.id, path, ...s };
}

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [ME, OTHER, STAFF]) await createUser(db, id);
  await createUser(db, ANON, { anonymous: true });
  await db.query(`update auth.users set email = 'me@example.invalid' where id = $1`, [ME]);
  const { rows } = await db.query<{ id: string; slug: string }>(
    `insert into tenants (slug, name, kind, area) values
       ('public', 'CleanSpot Community', 'public', null),
       ('lk-harburg-priv', 'Landkreis Harburg', 'municipality', $1::geography)
     on conflict (kind) where kind = 'public' do update set slug = excluded.slug, settings = excluded.settings
     returning id, slug`,
    [HARBURG_AREA],
  );
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  publicTenant = bySlug.public!;
  harburg = bySlug['lk-harburg-priv']!;
  await db.query(
    `insert into memberships (user_id, tenant_id, role) values
       ($1, $3, 'volunteer'), ($2, $3, 'volunteer'), ($4, $5, 'municipality_staff')`,
    [ME, OTHER, publicTenant, STAFF, harburg],
  );
  await db.query(`update tenants set settings = '{"reports_per_hour_registered": 1000}'`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('export_my_data', () => {
  it('contains account, profile, memberships, reports, photos, confirmations and events', async () => {
    const mine = await report(ME, { comment: 'Hinter der Scheune' });
    const theirs = await report(OTHER, { comment: 'not mine' });
    await rpc(as(ME), `select confirm_report($1)`, [theirs.id]);
    await rpc(as(ME), `select claim_report($1)`, [theirs.id]);

    const [row] = await rpc<{ data: Export }>(as(ME), `select export_my_data() as data`);
    const data = row!.data;
    expect(data.format).toBe('cleanspot-export-v1');
    expect(data.account).toMatchObject({
      id: ME,
      email: 'me@example.invalid',
      is_anonymous: false,
    });
    expect(data.profile).toMatchObject({ locale: 'de' });
    expect(data.memberships).toEqual([
      expect.objectContaining({ tenant: 'CleanSpot Community', role: 'volunteer' }),
    ]);

    const byId = Object.fromEntries(data.reports.map((r) => [r.id, r]));
    expect(byId[mine.id]).toMatchObject({
      my_role: ['reporter'],
      comment: 'Hinter der Scheune',
      category: 'mixed',
    });
    expect(byId[mine.id]!.lng).toBeCloseTo(mine.lng, 6);
    // Someone else's report the user claimed: in the export, but without the other's comment.
    expect(byId[theirs.id]).toMatchObject({ my_role: ['claimed'], comment: null });

    expect(data.photos.map((p) => p.storage_path)).toContain(mine.path);
    expect(data.photos.map((p) => p.storage_path)).not.toContain(theirs.path);
    expect(data.confirmations).toEqual([expect.objectContaining({ report_id: theirs.id })]);
    expect(data.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['created', 'confirmed', 'claimed']),
    );
    expect(data.bag_pickups).toEqual([]);
  });

  it('works for an anonymous session', async () => {
    const r = await report(ANON);
    const [row] = await rpc<{ data: Export }>(as(ANON, true), `select export_my_data() as data`);
    expect(row!.data.account).toMatchObject({ id: ANON, is_anonymous: true });
    expect(row!.data.reports.map((x) => x.id)).toEqual([r.id]);
  });

  it('needs a session (CS009); not callable by anon', async () => {
    await expect(rpc(as(null), `select export_my_data()`)).rejects.toThrow(/permission denied/);
  });
});

describe('delete_my_photos + storage delete policy', () => {
  it('removes own photo rows and returns their paths; then the files may be deleted', async () => {
    const u = randomUUID();
    await createUser(db, u);
    const r = await report(u);
    const other = await report(OTHER);

    // Attached: the file cannot be deleted through the API.
    if (sqlStorageDeletes) {
      const blocked = await rpc(
        as(u),
        `delete from storage.objects where name = $1 returning name`,
        [r.path],
      );
      expect(blocked).toEqual([]);
    }

    const paths = await rpc<{ p: string }>(as(u), `select delete_my_photos() as p`);
    expect(paths.map((x) => x.p)).toEqual([r.path]);
    expect(
      await one(`select count(*)::int as n from report_photos where uploaded_by = $1`, [u]),
    ).toEqual({ n: 0 });
    // The report itself stays.
    expect(await one(`select status from reports where id = $1`, [r.id])).toEqual({
      status: 'reported',
    });

    if (!sqlStorageDeletes) return;
    const deleted = await rpc(as(u), `delete from storage.objects where name = $1 returning name`, [
      r.path,
    ]);
    expect(deleted).toEqual([{ name: r.path }]);
    // Never someone else's file.
    await rpc(as(OTHER), `select delete_my_photos()`);
    const foreign = await rpc(as(u), `delete from storage.objects where name = $1 returning name`, [
      other.path,
    ]);
    expect(foreign).toEqual([]);
  });
});

describe('delete_my_account', () => {
  it('deletes the user, photos and comments; reports stay anonymous; claims are released', async () => {
    const u = randomUUID();
    await createUser(db, u);
    await db.query(
      `insert into memberships (user_id, tenant_id, role) values ($1, $2, 'volunteer')`,
      [u, publicTenant],
    );
    const own = await report(u, { comment: 'Ich wohne nebenan, Hausnr. 5' });
    const claimed = await report(OTHER);
    await rpc(as(u), `select confirm_report($1)`, [claimed.id]);
    await rpc(as(u), `select claim_report($1)`, [claimed.id]);

    await rpc(as(u), `select delete_my_account()`);

    expect(await one(`select count(*)::int as n from auth.users where id = $1`, [u])).toEqual({
      n: 0,
    });
    expect(await one(`select count(*)::int as n from profiles where id = $1`, [u])).toEqual({
      n: 0,
    });
    expect(await one(`select count(*)::int as n from memberships where user_id = $1`, [u])).toEqual(
      {
        n: 0,
      },
    );
    expect(
      await one(`select count(*)::int as n from report_photos where storage_path = $1`, [own.path]),
    ).toEqual({ n: 0 });
    expect(
      await one(`select reporter_id, comment, status from reports where id = $1`, [own.id]),
    ).toEqual({ reporter_id: null, comment: null, status: 'reported' });
    // The claim went back; the confirmation count stays (it was a real confirmation).
    expect(
      await one(`select status, claimed_by, confirmation_count from reports where id = $1`, [
        claimed.id,
      ]),
    ).toEqual({ status: 'confirmed', claimed_by: null, confirmation_count: 1 });
    const last = await one<{ type: string; actor_id: string | null; data: unknown }>(
      `select type, actor_id, data from report_events where report_id = $1 order by created_at desc, id desc limit 1`,
      [claimed.id],
    );
    expect(last).toEqual({
      type: 'unclaimed',
      actor_id: null,
      data: { reason: 'account_deleted' },
    });
    // The detached file is now an orphan for the maintenance job. "Older than -1 minute": on the
    // cloud this file runs in one transaction, where now() stays at the start of the transaction.
    const orphans = await rpc<{ p: string }>(
      { sub: null, role: 'service_role' },
      `select orphan_photo_paths(interval '-1 minute', 1000) as p`,
    );
    expect(orphans.map((o) => o.p)).toContain(own.path);
  });

  it('also for blocked and anonymous users', async () => {
    const blocked = randomUUID();
    await createUser(db, blocked);
    await db.query(`update profiles set blocked_until = now() + interval '1 day' where id = $1`, [
      blocked,
    ]);
    await rpc(as(blocked), `select delete_my_account()`);
    await rpc(as(ANON, true), `select delete_my_account()`);
    const { rows } = await db.query(`select id from auth.users where id = any($1)`, [
      [blocked, ANON],
    ]);
    expect(rows).toEqual([]);
  });

  it('is not callable without a session', async () => {
    await expect(rpc(as(null), `select delete_my_account()`)).rejects.toThrow(/permission denied/);
  });
});

describe('leave_volunteer_role', () => {
  it('drops volunteer memberships and gives back claims, except where the user is staff', async () => {
    const u = randomUUID();
    await createUser(db, u);
    await db.query(
      `insert into memberships (user_id, tenant_id, role) values ($1, $2, 'volunteer'), ($1, $3, 'municipality_staff')`,
      [u, publicTenant, harburg],
    );
    const pub = await report(OTHER);
    const muni = await report(OTHER, { area: 'harburg' });
    await rpc(as(u), `select claim_report($1)`, [pub.id]);
    await rpc(as(u), `select claim_report($1)`, [muni.id]);

    const [row] = await rpc<{ n: number }>(as(u), `select leave_volunteer_role() as n`);
    expect(row!.n).toBe(1);
    expect((await db.query(`select role from memberships where user_id = $1`, [u])).rows).toEqual([
      { role: 'municipality_staff' },
    ]);
    expect(await one(`select status, claimed_by from reports where id = $1`, [pub.id])).toEqual({
      status: 'reported',
      claimed_by: null,
    });
    expect(await one(`select status, claimed_by from reports where id = $1`, [muni.id])).toEqual({
      status: 'in_progress',
      claimed_by: u,
    });
    const last = await one<{ actor_id: string; data: unknown }>(
      `select actor_id, data from report_events where report_id = $1 order by created_at desc, id desc limit 1`,
      [pub.id],
    );
    expect(last).toEqual({ actor_id: u, data: { reason: 'left_volunteer_role' } });

    // A volunteer can no longer claim in the public area.
    const again = await report(OTHER);
    await expect(rpc(as(u), `select claim_report($1)`, [again.id])).rejects.toEqual(code('42501'));
  });

  it('without a volunteer role it does nothing', async () => {
    const [row] = await rpc<{ n: number }>(as(STAFF), `select leave_volunteer_role() as n`);
    expect(row!.n).toBe(0);
  });
});
