// @vitest-environment node
import { asActor, createTestDb, createUser, type Db } from './harness';

const ADMIN_HARBURG = '00000000-0000-4000-8000-000000000001';
const STAFF_OTHER = '00000000-0000-4000-8000-000000000002';
const ALICE = '00000000-0000-4000-8000-000000000003';
const BOB = '00000000-0000-4000-8000-000000000004';
const ANON_USER = '00000000-0000-4000-8000-000000000005';
const SUPER = '00000000-0000-4000-8000-000000000006';

// Rough boxes — the seed data uses proper boundaries.
const HARBURG_AREA =
  'MULTIPOLYGON(((9.60 53.15, 10.35 53.15, 10.35 53.48, 9.60 53.48, 9.60 53.15)))';
const OTHER_AREA =
  'MULTIPOLYGON(((11.00 52.00, 11.50 52.00, 11.50 52.50, 11.00 52.50, 11.00 52.00)))';
const BUCHHOLZ = 'POINT(9.876 53.326)';
const HAMBURG_CENTER = 'POINT(9.99 53.55)';

const RLS = /row-level security/;

let db: Db;
let harburg: string;
let other: string;
let publicTenant: string;

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [ADMIN_HARBURG, STAFF_OTHER, ALICE, BOB, SUPER]) await createUser(db, id);
  await createUser(db, ANON_USER, { anonymous: true });
  await db.query(`update profiles set is_super_admin = true where id = $1`, [SUPER]);

  const { rows } = await db.query<{ id: string; slug: string }>(
    `insert into tenants (slug, name, kind, area) values
       ('public', 'CleanSpot Community', 'public', null),
       ('lk-harburg', 'Landkreis Harburg', 'municipality', $1::geography),
       ('other', 'Other Town', 'municipality', $2::geography)
     returning id, slug`,
    [HARBURG_AREA, OTHER_AREA],
  );
  const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r.id]));
  publicTenant = bySlug.public!;
  harburg = bySlug['lk-harburg']!;
  other = bySlug.other!;

  await db.query(
    `insert into memberships (user_id, tenant_id, role) values
       ($1, $2, 'municipality_admin'), ($3, $4, 'municipality_staff'), ($5, $2, 'volunteer')`,
    [ADMIN_HARBURG, harburg, STAFF_OTHER, other, ALICE],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('signup trigger', () => {
  it('creates a profile for every auth user, including anonymous ones', async () => {
    const { rows } = await db.query(`select id from profiles where id = $1`, [ANON_USER]);
    expect(rows).toHaveLength(1);
  });
});

describe('tenant routing', () => {
  const route = async (point: string) => {
    const [row] = await asActor<{ t: string }>(
      db,
      { sub: null },
      `select tenant_for_point($1::geography) as t`,
      [point],
    );
    return row!.t;
  };

  it('routes a point inside a municipality area to that municipality', async () => {
    expect(await route(BUCHHOLZ)).toBe(harburg);
  });

  it('routes a point outside all municipalities to the public tenant', async () => {
    expect(await route(HAMBURG_CENTER)).toBe(publicTenant);
  });

  it('merges stored settings over defaults', async () => {
    await db.query(`update tenants set settings = '{"hotspot_threshold": 5}' where id = $1`, [
      harburg,
    ]);
    const [row] = await asActor<{ s: Record<string, unknown> }>(
      db,
      { sub: ALICE },
      `select tenant_settings($1) as s`,
      [harburg],
    );
    expect(row!.s.hotspot_threshold).toBe(5);
    expect(row!.s.hotspot_window_days).toBe(90);
  });
});

describe('tenants RLS', () => {
  it('anon can list tenants', async () => {
    const rows = await asActor(db, { sub: null }, `select id from tenants`);
    expect(rows).toHaveLength(3);
  });

  it('anon and normal users cannot create tenants', async () => {
    await expect(
      asActor(
        db,
        { sub: null },
        `insert into tenants (slug, name, kind) values ('x1', 'X', 'public')`,
      ),
    ).rejects.toThrow();
    await expect(
      asActor(
        db,
        { sub: ALICE },
        `insert into tenants (slug, name, kind, area) values ('x2', 'X', 'municipality', $1::geography)`,
        [OTHER_AREA],
      ),
    ).rejects.toThrow(RLS);
  });

  it('tenant admin can rename own tenant but not change its area', async () => {
    const renamed = await asActor(
      db,
      { sub: ADMIN_HARBURG },
      `update tenants set name = 'LK Harburg' where id = $1 returning id`,
      [harburg],
    );
    expect(renamed).toHaveLength(1);
    await expect(
      asActor(db, { sub: ADMIN_HARBURG }, `update tenants set area = $2::geography where id = $1`, [
        harburg,
        OTHER_AREA,
      ]),
    ).rejects.toThrow(/super admins/);
  });

  it('tenant admin cannot touch another tenant', async () => {
    const rows = await asActor(
      db,
      { sub: ADMIN_HARBURG },
      `update tenants set name = 'Hacked' where id = $1 returning id`,
      [other],
    );
    expect(rows).toHaveLength(0);
  });

  it('super admin can change an area', async () => {
    const rows = await asActor(
      db,
      { sub: SUPER },
      `update tenants set area = $2::geography where id = $1 returning id`,
      [other, OTHER_AREA],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('profiles RLS', () => {
  it('users see only their own profile', async () => {
    const rows = await asActor<{ id: string }>(db, { sub: BOB }, `select id from profiles`);
    expect(rows.map((r) => r.id)).toEqual([BOB]);
  });

  it('tenant staff see profiles of their members, not of other tenants', async () => {
    const rows = await asActor<{ id: string }>(
      db,
      { sub: ADMIN_HARBURG },
      `select id from profiles`,
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ALICE);
    expect(ids).not.toContain(STAFF_OTHER);
    expect(ids).not.toContain(BOB);
  });

  it('anon cannot read profiles, only public display names', async () => {
    await expect(asActor(db, { sub: null }, `select id from profiles`)).rejects.toThrow(
      /permission denied/,
    );
    const names = await asActor(db, { sub: null }, `select id, display_name from public_profiles`);
    expect(names.length).toBeGreaterThan(0);
  });

  it('users can edit their display name', async () => {
    const rows = await asActor(
      db,
      { sub: BOB },
      `update profiles set display_name = 'Bob' where id = $1 returning id`,
      [BOB],
    );
    expect(rows).toHaveLength(1);
  });

  it('users cannot make themselves super admin or change their block status', async () => {
    await expect(
      asActor(db, { sub: BOB }, `update profiles set is_super_admin = true where id = $1`, [BOB]),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      asActor(db, { sub: BOB }, `update profiles set blocked_until = now() where id = $1`, [BOB]),
    ).rejects.toThrow(/Not allowed/);
  });

  it("users cannot edit someone else's profile", async () => {
    const rows = await asActor(
      db,
      { sub: BOB },
      `update profiles set display_name = 'x' where id = $1 returning id`,
      [ALICE],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('memberships RLS', () => {
  const join = (actor: string, tenant: string, role: string, anonymous = false) =>
    asActor(
      db,
      { sub: actor, anonymous },
      `insert into memberships (user_id, tenant_id, role) values ($1, $2, $3) returning role`,
      [actor, tenant, role],
    );

  it('a registered user can join the public tenant as volunteer', async () => {
    expect(await join(BOB, publicTenant, 'volunteer')).toHaveLength(1);
  });

  it('nobody can self-assign a staff role or join a municipality directly', async () => {
    await expect(join(BOB, publicTenant, 'municipality_admin')).rejects.toThrow(RLS);
    await expect(join(BOB, harburg, 'volunteer')).rejects.toThrow(RLS);
  });

  it('anonymous users cannot join as volunteer', async () => {
    await expect(join(ANON_USER, publicTenant, 'volunteer', true)).rejects.toThrow(RLS);
  });

  it('tenant admin can add staff to own tenant only', async () => {
    const ok = await asActor(
      db,
      { sub: ADMIN_HARBURG },
      `insert into memberships (user_id, tenant_id, role) values ($1, $2, 'municipality_staff') returning role`,
      [BOB, harburg],
    );
    expect(ok).toHaveLength(1);
    await expect(
      asActor(
        db,
        { sub: ADMIN_HARBURG },
        `insert into memberships (user_id, tenant_id, role) values ($1, $2, 'municipality_staff')`,
        [BOB, other],
      ),
    ).rejects.toThrow(RLS);
  });

  it('a volunteer cannot promote themselves', async () => {
    const rows = await asActor(
      db,
      { sub: ALICE },
      `update memberships set role = 'municipality_admin' where user_id = $1 returning role`,
      [ALICE],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('memberships delete', () => {
  it('users can leave; admins can remove members of their tenant only', async () => {
    const del = (actor: string, user: string, tenant: string) =>
      asActor(
        db,
        { sub: actor },
        `delete from memberships where user_id = $1 and tenant_id = $2 returning user_id`,
        [user, tenant],
      );
    expect(await del(ALICE, ALICE, harburg)).toHaveLength(1);
    expect(await del(ADMIN_HARBURG, ALICE, harburg)).toHaveLength(1);
    expect(await del(BOB, ALICE, harburg)).toHaveLength(0);
    expect(await del(ADMIN_HARBURG, STAFF_OTHER, other)).toHaveLength(0);
  });
});
