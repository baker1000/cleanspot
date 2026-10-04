import { describe, expect, it, vi } from 'vitest';
import { createSupabaseDetailApi, PHOTO_URL_TTL_S, type DetailClient } from './api';

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const UID = 'bbbbbbbb-0000-4000-8000-0000000000aa';
const PUBLIC_TENANT = 'cccccccc-0000-4000-8000-000000000000';
const TENANT = 'dddddddd-0000-4000-8000-000000000000';

const reportRow = {
  id: ID,
  tenant_id: TENANT,
  lng: 10.11,
  lat: 53.38,
  category: 'bulky',
  hazard_type: null,
  is_hazardous: false,
  size: 'pile',
  status: 'confirmed',
  comment: 'Sofa',
  is_published: true,
  confirmation_count: 1,
  estimated_kg: '40.0',
  is_claimed: false,
  claimed_by_me: false,
  reported_by_me: true,
  created_at: '2026-10-01T10:00:00Z',
  cleared_at: null,
};

type Rows = Record<string, unknown>;
type Res = { data: unknown; error: unknown };

/**
 * Fake PostgREST: every query is recorded as "table?col=val&…" and answered from `tables`,
 * keyed by table name, or by "table?filters" for a more specific answer.
 */
function fakeClient(tables: Record<string, unknown>, rpc: Record<string, Res> = {}) {
  const queries: string[] = [];
  const answer = (key: string, table: string, single: boolean): Res => {
    const value = key in tables ? tables[key] : tables[table];
    if (value instanceof Error) return { data: null, error: value };
    return { data: single ? (value ?? null) : (value ?? []), error: null };
  };
  const query = (table: string) => {
    const filters: string[] = [];
    const key = () => `${table}${filters.length ? `?${filters.join('&')}` : ''}`;
    const q = {
      eq(col: string, val: unknown) {
        filters.push(`${col}=${String(val)}`);
        return q;
      },
      order: () => q,
      abortSignal: () => q,
      maybeSingle: () => {
        queries.push(key());
        return Promise.resolve(answer(key(), table, true));
      },
      then(resolve: (r: Res) => unknown, reject?: (e: unknown) => unknown) {
        queries.push(key());
        return Promise.resolve(answer(key(), table, false)).then(resolve, reject);
      },
    };
    return q;
  };
  const insert = vi.fn(
    async (_row: Rows): Promise<Res> => (tables.insertError as Res) ?? { data: null, error: null },
  );
  const upload = vi.fn(async (): Promise<Res> => ({ data: {}, error: null }));
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })),
    error: null,
  }));
  const rpcFn = vi.fn(async (fn: string, _args: Rows) => rpc[fn] ?? { data: null, error: null });
  const client = {
    from: (table: string) => ({ select: () => query(table), insert }),
    rpc: rpcFn,
    storage: { from: () => ({ upload, createSignedUrls }) },
  } as unknown as DetailClient;
  return {
    api: createSupabaseDetailApi(async () => client),
    queries,
    insert,
    upload,
    createSignedUrls,
    rpc: rpcFn,
  };
}

const photo = (id: string, path: string, extra: Rows = {}) => ({
  id,
  kind: 'before',
  storage_path: path,
  taken_at: null,
  ...extra,
});

describe('load', () => {
  it('visitor: public report, approved photos with signed URLs, timeline; no viewer queries', async () => {
    const { api, queries, createSignedUrls } = fakeClient({
      reports_public: reportRow,
      report_photos_public: [photo('p1', 'u/p1.webp')],
      report_events_public: [
        { id: 'e1', type: 'created', from_status: null, to_status: 'reported', created_at: 'c' },
      ],
      tenants: { name: 'Landkreis Harburg', settings: { cleanup_radius_m: 40 } },
    });
    const r = await api.load(ID, null);

    expect(r).toMatchObject({
      id: ID,
      tenantName: 'Landkreis Harburg',
      status: 'confirmed',
      comment: 'Sofa',
      estimatedKg: 40,
      reportedByMe: true,
      cleanupRadiusM: 40,
      viewer: null,
      photos: [
        {
          id: 'p1',
          kind: 'before',
          url: 'https://signed/u/p1.webp',
          pending: false,
          takenAt: null,
        },
      ],
      events: [
        { id: 'e1', type: 'created', fromStatus: null, toStatus: 'reported', createdAt: 'c' },
      ],
    });
    expect(createSignedUrls).toHaveBeenCalledWith(['u/p1.webp'], PHOTO_URL_TTL_S);
    expect(queries.some((q) => q.startsWith('report_photos?'))).toBe(false);
    expect(queries.some((q) => /^(memberships|report_confirmations)/.test(q))).toBe(false);
  });

  it('signed in: adds own photos under review (not rejected ones) and works out the role', async () => {
    const { api } = fakeClient({
      reports_public: reportRow,
      report_photos_public: [photo('p1', 'u/p1.webp')],
      report_events_public: [],
      tenants: { name: 'Landkreis Harburg', settings: {} },
      'tenants?kind=public': { id: PUBLIC_TENANT },
      report_photos: [
        photo('p1', 'u/p1.webp', { moderation: 'approved' }),
        photo('p2', 'u/p2.webp', { moderation: 'pending' }),
        photo('p3', 'u/p3.webp', { moderation: 'rejected' }),
      ],
      report_confirmations: null,
      memberships: [{ tenant_id: PUBLIC_TENANT, role: 'volunteer' }],
    });
    const r = await api.load(ID, UID);

    expect(r!.photos.map((p) => [p.id, p.pending])).toEqual([
      ['p1', false],
      ['p2', true],
    ]);
    expect(r!.cleanupRadiusM).toBe(50); // fallback without the setting
    expect(r!.viewer).toEqual({
      confirmed: false,
      role: 'volunteer',
      publicTenantId: PUBLIC_TENANT,
    });
  });

  it.each([
    [[{ tenant_id: TENANT, role: 'municipality_staff' }], 'staff'],
    [[{ tenant_id: TENANT, role: 'organizer' }], 'volunteer'],
    [[], 'none'],
  ])('memberships %j → role %s', async (memberships, role) => {
    const { api } = fakeClient({
      reports_public: reportRow,
      'tenants?kind=public': { id: PUBLIC_TENANT },
      memberships,
      report_confirmations: { report_id: ID },
    });
    const r = await api.load(ID, UID);
    expect(r!.viewer).toMatchObject({ role, confirmed: true });
  });

  it('unknown report → null; a malformed id never reaches the server', async () => {
    const { api, queries } = fakeClient({ reports_public: null });
    await expect(api.load(ID, null)).resolves.toBeNull();
    queries.length = 0;
    await expect(api.load('not-a-uuid', null)).resolves.toBeNull();
    expect(queries).toEqual([]);
  });

  it('a failing main query is an error (the page offers a retry)', async () => {
    const { api } = fakeClient({ reports_public: new Error('boom') });
    await expect(api.load(ID, null)).rejects.toThrow('boom');
  });
});

describe('actions', () => {
  it('confirm / claim / unclaim call their RPCs', async () => {
    const { api, rpc } = fakeClient({}, { confirm_report: { data: 3, error: null } });
    await expect(api.confirm(ID)).resolves.toBe(3);
    await api.claim(ID);
    await api.unclaim(ID);
    expect(rpc.mock.calls).toEqual([
      ['confirm_report', { p_report_id: ID }],
      ['claim_report', { p_report_id: ID }],
      ['unclaim_report', { p_report_id: ID }],
    ]);
  });

  it('maps RPC errors', async () => {
    const { api } = fakeClient({}, { claim_report: { data: null, error: { code: 'CS003' } } });
    await expect(api.claim(ID)).rejects.toMatchObject({ reason: 'claimed' });
  });

  it('join as volunteer inserts the membership; "already a member" counts as done', async () => {
    const ok = fakeClient({});
    await ok.api.joinAsVolunteer(UID, PUBLIC_TENANT);
    expect(ok.insert).toHaveBeenCalledWith({
      user_id: UID,
      tenant_id: PUBLIC_TENANT,
      role: 'volunteer',
    });
    const dup = fakeClient({ insertError: { data: null, error: { code: '23505' } } });
    await expect(dup.api.joinAsVolunteer(UID, PUBLIC_TENANT)).resolves.toBeUndefined();
    const denied = fakeClient({ insertError: { data: null, error: { code: '42501' } } });
    await expect(denied.api.joinAsVolunteer(UID, PUBLIC_TENANT)).rejects.toMatchObject({
      reason: 'not_allowed',
    });
  });

  it('cleanup uploads into the own folder, then submit_cleanup with location and time', async () => {
    const { api, upload, rpc } = fakeClient(
      {},
      { submit_cleanup: { data: { photo_id: 'ph', distance_m: 12.3 }, error: null } },
    );
    const P = 'eeeeeeee-0000-4000-8000-000000000001';
    const distance = await api.submitCleanup(
      {
        reportId: ID,
        photo: { id: P, blob: new Blob(['x']), ext: 'webp' },
        lng: 10.1,
        lat: 53.3,
        accuracyM: 8,
        takenAt: '2026-10-04T12:00:00.000Z',
      },
      UID,
    );
    expect(distance).toBe(12.3);
    expect(upload).toHaveBeenCalledWith(`${UID}/${P}.webp`, expect.any(Blob), {
      contentType: 'image/webp',
      upsert: false,
    });
    expect(rpc).toHaveBeenCalledWith('submit_cleanup', {
      p_report_id: ID,
      p_photo_path: `${UID}/${P}.webp`,
      p_lng: 10.1,
      p_lat: 53.3,
      p_taken_at: '2026-10-04T12:00:00.000Z',
      p_accuracy_m: 8,
    });
  });
});
