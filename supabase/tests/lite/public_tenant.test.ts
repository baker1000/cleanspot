// @vitest-environment node
import { createTestDb, type Db } from './harness';

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

describe('public tenant (migration 4)', () => {
  it('migrations create exactly one public tenant', async () => {
    const { rows } = await db.query<{ slug: string; kind: string }>(
      `select slug, kind from public.tenants where kind = 'public'`,
    );
    expect(rows).toEqual([{ slug: 'public', kind: 'public' }]);
  });

  it('points outside every municipality route to it', async () => {
    const {
      rows: [row],
    } = await db.query<{ ok: boolean }>(
      `select public.tenant_for_point(public.make_point(-30, 40)) =
              (select id from public.tenants where kind = 'public') as ok`,
    );
    expect(row?.ok).toBe(true);
  });
});
