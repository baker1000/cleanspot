// Edge Function: hourly maintenance (claim expiry + orphan photo cleanup).
// Called by pg_cron via pg_net with the `x-maintenance-secret` header. See README.md here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { isAuthorized, runMaintenance } from '../_shared/maintenance.ts';

const BUCKET = 'report-photos';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!isAuthorized(req.headers.get('x-maintenance-secret'), Deno.env.get('MAINTENANCE_SECRET'))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const result = await runMaintenance({
      async expireClaims() {
        const { data, error } = await supabase.rpc('expire_stale_claims');
        if (error) throw error;
        return data as number;
      },
      async orphanPaths(limit) {
        const { data, error } = await supabase.rpc('orphan_photo_paths', { p_limit: limit });
        if (error) throw error;
        return (data as string[] | null) ?? [];
      },
      async removeFiles(paths) {
        const { error } = await supabase.storage.from(BUCKET).remove(paths);
        if (error) throw error;
      },
    });
    return Response.json(result);
  } catch (error) {
    console.error('maintenance failed', error);
    return Response.json({ error: 'maintenance failed' }, { status: 500 });
  }
});
