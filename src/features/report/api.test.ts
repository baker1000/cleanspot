import { describe, expect, it, vi } from 'vitest';
import {
  classifyError,
  createSupabaseSubmitApi,
  SubmitError,
  type ReportDraft,
  type SubmitClient,
} from './api';

const UID = '00000000-0000-4000-8000-0000000000aa';
const P1 = 'a0000000-0000-4000-8000-000000000001';
const P2 = 'a0000000-0000-4000-8000-000000000002';

const draft = (over: Partial<ReportDraft> = {}): ReportDraft => ({
  clientId: 'c0000000-0000-4000-8000-000000000001',
  lng: 10.11,
  lat: 53.38,
  accuracyM: 12,
  category: 'mixed',
  hazardType: 'chemicals',
  size: 'pile',
  comment: '  ',
  photos: [
    { id: P1, blob: new Blob(['a']), ext: 'webp' },
    { id: P2, blob: new Blob(['b']), ext: 'jpg' },
  ],
  ...over,
});

type Res = { data: unknown; error: unknown };

function fakeClient(opts: { rpc?: Record<string, Res>; upload?: Res } = {}) {
  const log: string[] = [];
  const rpc = vi.fn((fn: string, _args: Record<string, unknown>) => {
    log.push(`rpc ${fn}`);
    const fallback = { data: fn === 'submit_report' ? 'r1' : null, error: null };
    return Promise.resolve(opts.rpc?.[fn] ?? fallback);
  });
  const upload = vi.fn(async (path: string, _body: Blob, _o: unknown) => {
    log.push(`upload ${path}`);
    return opts.upload ?? { data: { path }, error: null };
  });
  const client = { rpc, storage: { from: vi.fn(() => ({ upload })) } } as unknown as SubmitClient;
  return { rpc, upload, log, api: createSupabaseSubmitApi(async () => client) };
}

describe('submit', () => {
  it('uploads photos first, then creates the report, then attaches the photos', async () => {
    const { api, rpc, upload, log } = fakeClient();
    await expect(api.submit(draft(), UID)).resolves.toBe('r1');
    expect(log).toEqual([
      `upload ${UID}/${P1}.webp`,
      `upload ${UID}/${P2}.jpg`,
      'rpc submit_report',
      'rpc add_report_photo',
      'rpc add_report_photo',
    ]);
    expect(upload.mock.calls[1]).toEqual([
      `${UID}/${P2}.jpg`,
      expect.any(Blob),
      { contentType: 'image/jpeg', upsert: false },
    ]);
    // Hazard type only for hazardous reports; a blank comment is sent as null.
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_client_id: 'c0000000-0000-4000-8000-000000000001',
      p_lng: 10.11,
      p_lat: 53.38,
      p_category: 'mixed',
      p_size: 'pile',
      p_hazard_type: null,
      p_comment: null,
      p_accuracy_m: 12,
    });
    expect(rpc.mock.calls[1]![1]).toEqual({ p_report_id: 'r1', p_path: `${UID}/${P1}.webp` });
  });

  it('sends the hazard type for hazardous reports and trims the comment', async () => {
    const { api, rpc } = fakeClient();
    await api.submit(draft({ category: 'hazardous', comment: ' Kanister ' }), UID);
    expect(rpc.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ p_hazard_type: 'chemicals', p_comment: 'Kanister' }),
    );
  });

  it('is safe to retry: existing uploads and attached photos count as done', async () => {
    const { api } = fakeClient({
      upload: { data: null, error: { statusCode: '409', message: 'The resource already exists' } },
      rpc: {
        add_report_photo: {
          data: null,
          error: { code: 'CS005', message: 'Photo already attached' },
        },
      },
    });
    await expect(api.submit(draft(), UID)).resolves.toBe('r1');
  });

  it('stops before creating the report when an upload fails', async () => {
    const { api, rpc } = fakeClient({
      upload: { data: null, error: { statusCode: '413', message: 'Payload too large' } },
    });
    await expect(api.submit(draft(), UID)).rejects.toEqual(new SubmitError('photo'));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not treat other photo errors as "already attached"', async () => {
    const { api } = fakeClient({
      rpc: {
        add_report_photo: { data: null, error: { code: 'CS005', message: 'Photo not uploaded' } },
      },
    });
    await expect(api.submit(draft(), UID)).rejects.toMatchObject({ reason: 'photo' });
  });

  it('maps the rate limit', async () => {
    const { api } = fakeClient({
      rpc: { submit_report: { data: null, error: { code: 'PT429', message: 'Too many reports' } } },
    });
    await expect(api.submit(draft(), UID)).rejects.toMatchObject({ reason: 'rate_limited' });
  });

  it('maps a thrown network error', async () => {
    const { api, upload } = fakeClient();
    upload.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.submit(draft(), UID)).rejects.toMatchObject({ reason: 'network' });
  });
});

describe('tenantAt / nearby', () => {
  it('maps tenant_at_point and returns null on errors', async () => {
    const ok = fakeClient({
      rpc: {
        tenant_at_point: {
          data: [
            {
              tenant_id: 't',
              kind: 'municipality',
              name: 'Landkreis Harburg',
              bulky_waste_url: null,
            },
          ],
          error: null,
        },
      },
    });
    await expect(ok.api.tenantAt(10, 53)).resolves.toEqual({
      kind: 'municipality',
      name: 'Landkreis Harburg',
      bulkyWasteUrl: null,
    });
    const missing = fakeClient({
      rpc: { tenant_at_point: { data: null, error: { code: 'PGRST202' } } },
    });
    await expect(missing.api.tenantAt(10, 53)).resolves.toBeNull();
  });

  it('maps find_nearby_open_reports and returns [] on errors', async () => {
    const ok = fakeClient({
      rpc: {
        find_nearby_open_reports: {
          data: [{ id: 'n1', distance_m: 12.5, category: 'bulky', status: 'reported' }],
          error: null,
        },
      },
    });
    await expect(ok.api.nearby(10, 53)).resolves.toEqual([
      { id: 'n1', distanceM: 12.5, category: 'bulky', status: 'reported' },
    ]);
    const broken = fakeClient({ rpc: { find_nearby_open_reports: { data: null, error: {} } } });
    await expect(broken.api.nearby(10, 53)).resolves.toEqual([]);
  });
});

describe('classifyError', () => {
  it.each([
    [{ code: 'PT429' }, 'rate_limited'],
    [{ status: 429 }, 'rate_limited'],
    [{ code: '42501' }, 'blocked'],
    [{ code: 'CS007' }, 'invalid'],
    [{ code: 'CS006' }, 'photo'],
    [new TypeError('Failed to fetch'), 'network'],
    [{ message: 'boom' }, 'server'],
  ])('%j is %s', (error, reason) => {
    expect(classifyError(error)).toBe(reason);
  });
});
