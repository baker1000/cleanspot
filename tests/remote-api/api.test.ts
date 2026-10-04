// @vitest-environment node
/**
 * API-level verification against a real Supabase project (VERIFY_ON_SUPABASE.md, rows marked
 * "API"). Goes through PostgREST, Storage and Edge Functions like the app does.
 *
 * Creates its own tenant (slug verify-*), users (verify-*@example.invalid) and files, and deletes
 * all of them in afterAll. Leftovers from a crashed run are removed at the start of the next run.
 *
 * Run with: npm run verify:remote
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { loadCloudEnv, pgSslOptions } from '../../supabase/tests/lite/harness';
import {
  createSupabaseSubmitApi,
  photoPath,
  type SubmitClient,
} from '../../src/features/report/api';

loadCloudEnv();
const env = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} missing in .env.supabase-cloud`);
  return value;
};
const URL_ = env('SUPABASE_URL');
const PUBLISHABLE = env('SUPABASE_PUBLISHABLE_KEY');
const SECRET = env('SUPABASE_SECRET_KEY');
const MAINTENANCE_SECRET = process.env.MAINTENANCE_SECRET;

const RUN = randomUUID().slice(0, 8);
const SLUG = `verify-${RUN}`;
// Test area in the North Sea, far from any real report.
const AREA = 'SRID=4326;MULTIPOLYGON(((7.0 54.0, 7.1 54.0, 7.1 54.1, 7.0 54.1, 7.0 54.0)))';
const SPOT = { lng: 7.05, lat: 54.05 };
const PASSWORD = `Verify-${randomUUID()}`;

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = () => createClient(URL_, PUBLISHABLE, noPersist);

let sql: pg.Client;
let admin: SupabaseClient;
let anon: SupabaseClient;
let reporter: SupabaseClient;
let staff: SupabaseClient;
let anonymousUser: SupabaseClient;
const ids: Record<string, string> = {};
const createdUserIds: string[] = [];
const uploaded: string[] = [];
let tenantId: string;

const webp = (bytes = 128) => new Uint8Array(bytes).fill(7);

async function upload(
  client: SupabaseClient,
  uid: string,
  body = webp(),
  contentType = 'image/webp',
) {
  const path = `${uid}/${randomUUID()}.webp`;
  const res = await client.storage.from('report-photos').upload(path, body, { contentType });
  if (!res.error) uploaded.push(path);
  return { path, error: res.error };
}

async function signedInUser(label: string) {
  const email = `verify-${RUN}-${label}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = newClient();
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw signIn.error;
  return { client, id: data.user.id };
}

async function submitReport(client: SupabaseClient, offsetDeg = 0) {
  return client.rpc('submit_report', {
    p_client_id: randomUUID(),
    p_lng: SPOT.lng + offsetDeg,
    p_lat: SPOT.lat,
    p_category: 'mixed',
    p_size: 'bag',
    p_comment: 'verify run',
  });
}

async function cleanupLeftovers() {
  const { rows } = await sql.query(`select id from public.tenants where slug like 'verify-%'`);
  for (const { id } of rows) {
    const photos = await sql.query(
      `select p.storage_path from public.report_photos p join public.reports r on r.id = p.report_id where r.tenant_id = $1`,
      [id],
    );
    const paths = photos.rows.map((r) => r.storage_path as string);
    if (paths.length) await admin.storage.from('report-photos').remove(paths);
    await sql.query(`delete from public.reports where tenant_id = $1`, [id]);
    await sql.query(`delete from public.tenants where id = $1`, [id]);
  }
  const users = await sql.query(
    `select id from auth.users where email like 'verify-%@example.invalid'`,
  );
  for (const { id } of users.rows) await admin.auth.admin.deleteUser(id);
}

beforeAll(async () => {
  sql = new pg.Client({ connectionString: env('SUPABASE_DB_URL'), ssl: pgSslOptions() });
  await sql.connect();
  admin = createClient(URL_, SECRET, noPersist);
  await cleanupLeftovers();

  const t = await sql.query(
    `insert into public.tenants (slug, name, kind, area) values ($1, 'Verify run', 'municipality', $2::geography) returning id`,
    [SLUG, AREA],
  );
  tenantId = t.rows[0].id;

  anon = newClient();
  const r = await signedInUser('reporter');
  reporter = r.client;
  ids.reporter = r.id;
  const s = await signedInUser('staff');
  staff = s.client;
  ids.staff = s.id;
  await sql.query(
    `insert into public.memberships (user_id, tenant_id, role) values ($1, $2, 'municipality_staff')`,
    [s.id, tenantId],
  );

  anonymousUser = newClient();
  const a = await anonymousUser.auth.signInAnonymously();
  if (a.error) throw new Error(`Anonymous sign-ins must be enabled: ${a.error.message}`);
  ids.anonymous = a.data.user!.id;
  createdUserIds.push(a.data.user!.id);
}, 120_000);

afterAll(async () => {
  try {
    if (uploaded.length) await admin.storage.from('report-photos').remove(uploaded);
    if (tenantId) {
      await sql.query(`delete from public.reports where tenant_id = $1`, [tenantId]);
      await sql.query(`delete from public.tenants where id = $1`, [tenantId]);
    }
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  } finally {
    await sql?.end();
  }
}, 120_000);

describe('A — platform assumptions', () => {
  it('A1: anonymous sessions carry is_anonymous, which the RPCs read', async () => {
    const { data: user } = await anonymousUser.auth.getUser();
    expect(user.user?.is_anonymous).toBe(true);
    const { data: id } = await submitReport(reporter, 0.001);
    const { error } = await anonymousUser.rpc('confirm_report', { p_report_id: id });
    expect(error?.code).toBe('CS008');
  });

  it('A2: anon reads reports_public (security-definer view), comment hidden', async () => {
    const { data: id, error } = await submitReport(reporter, 0.002);
    expect(error).toBeNull();
    const res = await anon.from('reports_public').select('id, comment, lng, lat').eq('id', id);
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1);
    expect(res.data![0]!.comment).toBeNull();
    expect(res.data![0]!.lng).toBeCloseTo(SPOT.lng + 0.002, 5);
  });

  it('F1/F2: anon calls reports_in_bbox through PostgREST like the map does', async () => {
    const { data: id } = await submitReport(reporter, 0.005);
    const box = {
      p_min_lng: SPOT.lng,
      p_min_lat: SPOT.lat - 0.01,
      p_max_lng: SPOT.lng + 0.01,
      p_max_lat: SPOT.lat + 0.01,
    };
    const all = await anon.rpc('reports_in_bbox', { ...box, p_statuses: null, p_limit: 2000 });
    expect(all.error).toBeNull();
    const row = (all.data as { id: string; comment: string | null }[]).find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row!.comment).toBeNull();
    const other = await anon.rpc('reports_in_bbox', { ...box, p_categories: ['bulky'] });
    expect(other.error).toBeNull();
    expect((other.data as { id: string }[]).map((r) => r.id)).not.toContain(id);
  });

  it('F3: anon calls tenant_at_point like the report form does', async () => {
    const inside = await anon.rpc('tenant_at_point', { p_lng: SPOT.lng, p_lat: SPOT.lat });
    expect(inside.error).toBeNull();
    expect(inside.data).toEqual([
      { tenant_id: tenantId, kind: 'municipality', name: 'Verify run', bulky_waste_url: null },
    ]);
    const outside = await anon.rpc('tenant_at_point', { p_lng: -30, p_lat: 40 });
    expect(outside.error).toBeNull();
    expect((outside.data as { kind: string }[])[0]!.kind).toBe('public');
  });

  it('F4: the app submit pipeline works end to end for an anonymous user (and retries)', async () => {
    const client = newClient();
    const a = await client.auth.signInAnonymously();
    expect(a.error).toBeNull();
    const uid = a.data.user!.id;
    createdUserIds.push(uid);
    const api = createSupabaseSubmitApi(async () => client as unknown as SubmitClient);
    const photo = {
      id: randomUUID(),
      blob: new Blob([webp(256)], { type: 'image/webp' }),
      ext: 'webp' as const,
    };
    uploaded.push(photoPath(uid, photo));
    const draft = {
      clientId: randomUUID(),
      lng: SPOT.lng + 0.004,
      lat: SPOT.lat,
      accuracyM: 7,
      category: 'hazardous' as const,
      hazardType: 'batteries' as const,
      size: 'bag' as const,
      comment: ' verify run ',
      photos: [photo],
      // As the offline queue sends it: the photo keeps the time the report was made.
      takenAt: '2026-10-04T08:15:00.000Z',
    };

    const id = await api.submit(draft, uid);
    // A retry (e.g. after a lost response) returns the same report and adds nothing.
    await expect(api.submit(draft, uid)).resolves.toBe(id);

    const { rows } = await sql.query(
      `select r.tenant_id, r.reporter_id, r.hazard_type, r.comment, r.accuracy_m,
              (select count(*)::int from public.report_photos p where p.report_id = r.id) as photos,
              (select p.storage_path from public.report_photos p where p.report_id = r.id) as path,
              (select p.taken_at from public.report_photos p where p.report_id = r.id) as taken_at
       from public.reports r where r.id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      tenant_id: tenantId,
      reporter_id: uid,
      hazard_type: 'batteries',
      comment: 'verify run',
      accuracy_m: 7,
      photos: 1,
      path: photoPath(uid, photo),
      taken_at: new Date('2026-10-04T08:15:00.000Z'),
    });
  });

  it('A8: anon cannot read base tables; other users get no rows', async () => {
    const denied = await anon.from('reports').select('id');
    expect(denied.error?.code).toBe('42501');
    const { data: id } = await submitReport(reporter, 0.003);
    const other = await anonymousUser.from('reports').select('id').eq('id', id);
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);
  });

  it('A9: internal helpers are not callable through the API', async () => {
    for (const client of [anon, reporter]) {
      const a = await client.rpc('log_report_event', {
        p_report_id: randomUUID(),
        p_type: 'created',
      });
      expect(a.error).not.toBeNull();
      const b = await client.rpc('expire_stale_claims');
      expect(b.error).not.toBeNull();
      const c = await client.rpc('orphan_photo_paths');
      expect(c.error).not.toBeNull();
    }
  });

  it('A7: PT429 becomes HTTP 429; custom codes reach the client', async () => {
    const client = newClient();
    const a = await client.auth.signInAnonymously();
    expect(a.error).toBeNull();
    createdUserIds.push(a.data.user!.id);
    let last: Awaited<ReturnType<typeof submitReport>> | undefined;
    for (let i = 0; i < 6; i++) last = await submitReport(client, 0.01 + i * 0.001);
    expect(last!.error?.code).toBe('PT429');
    expect(last!.status).toBe(429);
  });
});

describe('Storage', () => {
  it('A5/A6/C37: upload into own folder works, into another folder fails', async () => {
    expect((await upload(reporter, ids.reporter!)).error).toBeNull();
    expect((await upload(reporter, ids.staff!)).error).not.toBeNull();
  });

  it('C40: bucket rejects files over 5 MiB and non-image types', async () => {
    const big = await upload(reporter, ids.reporter!, webp(6 * 1024 * 1024));
    expect(big.error).not.toBeNull();
    const text = await upload(reporter, ids.reporter!, webp(), 'text/plain');
    expect(text.error).not.toBeNull();
  });

  it('C39: pending photo unreadable for anon; readable after staff approval', async () => {
    const { data: reportId } = await submitReport(reporter, 0.004);
    const { path } = await upload(reporter, ids.reporter!);
    const attach = await reporter.rpc('add_report_photo', { p_report_id: reportId, p_path: path });
    expect(attach.error).toBeNull();

    expect((await anon.storage.from('report-photos').download(path)).error).not.toBeNull();
    expect((await reporter.storage.from('report-photos').download(path)).error).toBeNull();

    const approve = await staff.rpc('moderate_photo', { p_photo_id: attach.data, p_approve: true });
    expect(approve.error).toBeNull();
    const after = await anon.storage.from('report-photos').download(path);
    expect(after.error).toBeNull();
    expect(after.data?.size).toBe(128);
  });
});

describe('D — maintenance', () => {
  it('D5: pg_cron job for claim expiry exists', async () => {
    const { rows } = await sql.query(
      `select schedule from cron.job where jobname = 'cleanspot-expire-claims'`,
    );
    expect(rows).toEqual([{ schedule: '7 * * * *' }]);
  });

  const fnUrl = `${URL_}/functions/v1/maintenance`;

  it.skipIf(!MAINTENANCE_SECRET)(
    'D6: function rejects calls without the right secret',
    async () => {
      expect((await fetch(fnUrl, { method: 'POST' })).status).toBe(401);
      const wrong = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'x-maintenance-secret': 'nope' },
      });
      expect(wrong.status).toBe(401);
    },
  );

  it.skipIf(!MAINTENANCE_SECRET)(
    'D6: function deletes orphan files through the Storage API',
    async () => {
      const { path, error } = await upload(reporter, ids.reporter!);
      expect(error).toBeNull();
      await sql.query(
        `update storage.objects set created_at = now() - interval '25 hours' where bucket_id = 'report-photos' and name = $1`,
        [path],
      );
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'x-maintenance-secret': MAINTENANCE_SECRET!,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { removedOrphans: number };
      expect(body.removedOrphans).toBeGreaterThanOrEqual(1);
      // The file itself is gone, not only its row.
      expect((await admin.storage.from('report-photos').download(path)).error).not.toBeNull();
      const { rows } = await sql.query(`select 1 from storage.objects where name = $1`, [path]);
      expect(rows).toHaveLength(0);
    },
  );

  it('D7: the scheduled job reaches the function with the Vault secrets', async () => {
    const job = await sql.query(
      `select schedule, command, active from cron.job where jobname = 'cleanspot-maintenance'`,
    );
    expect(job.rows).toHaveLength(1);
    expect(job.rows[0].schedule).toBe('17 * * * *');
    expect(job.rows[0].active).toBe(true);

    const { path, error } = await upload(reporter, ids.reporter!);
    expect(error).toBeNull();
    await sql.query(
      `update storage.objects set created_at = now() - interval '25 hours' where bucket_id = 'report-photos' and name = $1`,
      [path],
    );

    // Run exactly what pg_cron runs, then wait for pg_net's background worker to get the answer.
    const call = await sql.query<{ id: string }>(
      `select id from (${String(job.rows[0].command).trim().replace(/;$/, '')}) as r(id)`,
    );
    const requestId = call.rows[0]!.id;
    let response: { status_code: number | null; content: string | null; error_msg: string | null } =
      { status_code: null, content: null, error_msg: null };
    for (let i = 0; i < 60 && response.status_code === null && !response.error_msg; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await sql.query(
        `select status_code, content, error_msg from net._http_response where id = $1`,
        [requestId],
      );
      if (res.rows[0]) response = res.rows[0];
    }
    expect(response.error_msg).toBeNull();
    expect(response.status_code).toBe(200);
    expect(JSON.parse(response.content!).removedOrphans).toBeGreaterThanOrEqual(1);
    expect((await admin.storage.from('report-photos').download(path)).error).not.toBeNull();
  }, 90_000);
});
