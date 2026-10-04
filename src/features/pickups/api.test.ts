import { describe, expect, it, vi } from 'vitest';
import type { DetailClient } from '@/features/detail/api';
import { createSupabasePickupsApi } from './api';

function fakeClient(opts: { memberships?: unknown; tasks?: unknown; rpcError?: unknown } = {}) {
  const eq = vi.fn(async () => ({ data: opts.memberships ?? [], error: null }));
  const select = vi.fn(() => ({ eq }));
  const rpc = vi.fn(async (fn: string) =>
    opts.rpcError
      ? { data: null, error: opts.rpcError }
      : { data: fn === 'open_pickup_tasks' ? (opts.tasks ?? []) : null, error: null },
  );
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })),
    error: null,
  }));
  const client = {
    from: vi.fn(() => ({ select })),
    rpc,
    storage: { from: () => ({ createSignedUrls }) },
  } as unknown as DetailClient;
  return { api: createSupabasePickupsApi(async () => client), select, eq, rpc, createSignedUrls };
}

describe('pickups api', () => {
  it('staff tenants: only staff and admin memberships, with the tenant name', async () => {
    const { api, select, eq } = fakeClient({
      memberships: [
        { tenant_id: 'a', role: 'municipality_staff', tenants: { name: 'Landkreis Harburg' } },
        { tenant_id: 'b', role: 'volunteer', tenants: { name: 'CleanSpot Community' } },
        { tenant_id: 'c', role: 'municipality_admin', tenants: null },
      ],
    });
    await expect(api.staffTenants('u1')).resolves.toEqual([
      { id: 'a', name: 'Landkreis Harburg' },
      { id: 'c', name: 'c' },
    ]);
    expect(select).toHaveBeenCalledWith('tenant_id, role, tenants(name)');
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('open tasks: mapped, with signed photo URLs', async () => {
    const { api, rpc, createSignedUrls } = fakeClient({
      tasks: [
        {
          id: 't1',
          report_id: 'r1',
          lng: 10.1,
          lat: 53.4,
          accuracy_m: 6,
          bag_count: 3,
          estimated_kg: '18.0',
          photo_path: 'u/b.webp',
          category: 'plastic',
          created_at: 'c',
        },
        {
          id: 't2',
          report_id: 'r2',
          lng: 10.2,
          lat: 53.5,
          accuracy_m: null,
          bag_count: 1,
          estimated_kg: null,
          photo_path: null,
          category: 'mixed',
          created_at: 'd',
        },
      ],
    });
    const stops = await api.openTasks('tenant');
    expect(rpc).toHaveBeenCalledWith('open_pickup_tasks', { p_tenant_id: 'tenant' });
    expect(createSignedUrls).toHaveBeenCalledWith(['u/b.webp'], 3600);
    expect(stops).toEqual([
      {
        id: 't1',
        reportId: 'r1',
        lng: 10.1,
        lat: 53.4,
        accuracyM: 6,
        bagCount: 3,
        estimatedKg: 18,
        category: 'plastic',
        createdAt: 'c',
        photoUrl: 'https://signed/u/b.webp',
      },
      expect.objectContaining({ id: 't2', estimatedKg: null, photoUrl: null }),
    ]);
  });

  it('collect / cancel call their RPCs; errors are mapped', async () => {
    const ok = fakeClient();
    await ok.api.collect('t1');
    await ok.api.cancel('t2');
    expect(ok.rpc.mock.calls).toEqual([
      ['collect_pickup', { p_task_id: 't1' }],
      ['cancel_pickup', { p_task_id: 't2' }],
    ]);
    const denied = fakeClient({ rpcError: { code: '42501' } });
    await expect(denied.api.openTasks('x')).rejects.toMatchObject({ reason: 'not_allowed' });
  });
});
