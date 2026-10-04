import { describe, expect, it, vi } from 'vitest';
import { ActionError } from '@/features/detail/api';
import { createSupabaseProfileApi, EXPORT_PHOTO_URL_TTL_S, type ProfileClient } from './api';

type RpcResult = { data: unknown; error: unknown };

function fakeClient(rpcResults: Record<string, RpcResult> = {}, memberships: unknown[] = []) {
  const calls: string[] = [];
  const remove = vi.fn(async (paths: string[]) => {
    calls.push(`remove:${paths.length}`);
    return { data: null, error: null };
  });
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })),
    error: null,
  }));
  const eq = vi.fn(() => Promise.resolve({ data: memberships, error: null }));
  const client = {
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
    rpc: vi.fn(async (fn: string) => {
      calls.push(fn);
      return rpcResults[fn] ?? { data: null, error: null };
    }),
    storage: { from: vi.fn(() => ({ createSignedUrls, remove })) },
  };
  return { client: client as unknown as ProfileClient, calls, remove, createSignedUrls, eq };
}

const NOW = new Date('2026-10-05T10:00:00Z');
const api = (c: ProfileClient) =>
  createSupabaseProfileApi(
    async () => c,
    () => NOW,
  );

describe('exportData', () => {
  it('adds photo download links and names the file by date', async () => {
    const f = fakeClient({
      export_my_data: {
        data: { format: 'cleanspot-export-v1', photos: [{ storage_path: 'u/a.webp' }] },
        error: null,
      },
    });
    const file = await api(f.client).exportData();
    expect(file.fileName).toBe('cleanspot-data-2026-10-05.json');
    const parsed = JSON.parse(file.json);
    expect(parsed.photos).toEqual([
      { storage_path: 'u/a.webp', download_url: 'https://signed/u/a.webp' },
    ]);
    expect(parsed.photo_links_valid_until).toBe('2026-10-12T10:00:00.000Z');
    expect(f.createSignedUrls).toHaveBeenCalledWith(['u/a.webp'], EXPORT_PHOTO_URL_TTL_S);
  });

  it('without photos signs nothing', async () => {
    const f = fakeClient({ export_my_data: { data: { photos: [] }, error: null } });
    await api(f.client).exportData();
    expect(f.createSignedUrls).not.toHaveBeenCalled();
  });

  it('maps server errors', async () => {
    const f = fakeClient({ export_my_data: { data: null, error: { code: 'CS009' } } });
    await expect(api(f.client).exportData()).rejects.toEqual(new ActionError('account'));
  });
});

describe('deleteAccount', () => {
  it('detaches photos, removes the files in batches, then deletes the account', async () => {
    const paths = Array.from({ length: 150 }, (_, i) => `u/${i}.webp`);
    const f = fakeClient({ delete_my_photos: { data: paths, error: null } });
    await api(f.client).deleteAccount();
    expect(f.calls).toEqual(['delete_my_photos', 'remove:100', 'remove:50', 'delete_my_account']);
  });

  it('still deletes the account when removing files fails (orphans go with maintenance)', async () => {
    const f = fakeClient({ delete_my_photos: { data: ['u/a.webp'], error: null } });
    f.remove.mockRejectedValueOnce(new Error('offline'));
    await api(f.client).deleteAccount();
    expect(f.calls.at(-1)).toBe('delete_my_account');
  });

  it('stops when the server refuses', async () => {
    const f = fakeClient({ delete_my_photos: { data: null, error: { code: '42501' } } });
    await expect(api(f.client).deleteAccount()).rejects.toEqual(new ActionError('not_allowed'));
    expect(f.calls).toEqual(['delete_my_photos']);
  });
});

describe('volunteer role', () => {
  it('isVolunteer looks at the memberships', async () => {
    expect(await api(fakeClient({}, [{ role: 'volunteer' }]).client).isVolunteer('u')).toBe(true);
    expect(
      await api(fakeClient({}, [{ role: 'municipality_staff' }]).client).isVolunteer('u'),
    ).toBe(false);
  });

  it('leaveVolunteerRole returns the number of released claims', async () => {
    const f = fakeClient({ leave_volunteer_role: { data: 2, error: null } });
    expect(await api(f.client).leaveVolunteerRole()).toBe(2);
  });
});
