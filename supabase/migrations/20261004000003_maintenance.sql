-- CleanSpot · Migration 3: maintenance jobs.
--
--   * expire_stale_claims(): claims older than `claim_expiry_hours` (default 72) are released.
--     Pure SQL, scheduled hourly with pg_cron where available.
--   * orphan_photo_paths(): uploaded photos never attached to a report. Files must be deleted
--     through the Storage API (deleting storage.objects rows leaves the file behind), so the
--     `maintenance` Edge Function lists them here and removes them. See supabase/functions/maintenance.

create or replace function public.default_tenant_settings()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'auto_approve_confirmations', 3,     -- photos become public after N community confirmations
    'gamification_enabled', true,        -- points and badges
    'leaderboard_enabled', true,         -- public team leaderboard
    'hotspot_threshold', 3,              -- reports per area ...
    'hotspot_window_days', 90,           -- ... within this many days => chronic hotspot
    'duplicate_radius_m', 30,
    'cleanup_radius_m', 50,
    'allow_volunteer_claims', true,      -- false = only staff may claim/clear in this tenant
    'claim_expiry_hours', 72,            -- unfinished claims are released after this time
    'reports_per_hour_anonymous', 5,
    'reports_per_hour_registered', 20,
    'bulky_waste_url', null,             -- link to local bulky-waste booking
    'kg_per_size', jsonb_build_object('bag', 5, 'pile', 40, 'container', 300, 'truck', 1500),
    'kg_per_bag', 6
  );
$$;

-- Releases claims older than the tenant's claim_expiry_hours. Returns the number released.
-- Timeline events have actor_id = null and data.reason = 'expired'.
create function public.expire_stale_claims()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.reports r
    set status = case when r.confirmation_count > 0 then 'confirmed' else 'reported' end::public.report_status,
        claimed_by = null,
        claimed_at = null
    from public.tenants t
    where t.id = r.tenant_id
      and r.status = 'in_progress'
      and r.claimed_at < now() - make_interval(
        hours => (public.tenant_settings(t.id) ->> 'claim_expiry_hours')::int
      )
    returning r.id, r.status
  ),
  logged as (
    insert into public.report_events (report_id, actor_id, type, from_status, to_status, data)
    select e.id, null, 'unclaimed', 'in_progress', e.status, '{"reason": "expired"}'::jsonb
    from expired e
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end;
$$;

-- Photo objects that were uploaded but never attached, older than the grace period.
-- The grace period covers the gap between upload and attach in the offline queue.
create function public.orphan_photo_paths(
  p_older_than interval default interval '24 hours',
  p_limit integer default 500
)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'report-photos'
    and o.created_at < now() - p_older_than
    and not exists (select 1 from public.report_photos p where p.storage_path = o.name)
  order by o.created_at
  limit least(greatest(p_limit, 1), 1000);
$$;

-- Service role only (cron / Edge Functions).
revoke execute on function public.expire_stale_claims() from public, anon, authenticated;
revoke execute on function public.orphan_photo_paths(interval, integer) from public, anon, authenticated;
grant execute on function public.expire_stale_claims() to service_role;
grant execute on function public.orphan_photo_paths(interval, integer) to service_role;

-- Schedule claim expiry hourly if pg_cron is available (Supabase cloud + self-hosted image).
-- Skipped silently elsewhere (e.g. PGlite tests).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('cleanspot-expire-claims', '7 * * * *', 'select public.expire_stale_claims()');
  end if;
end;
$$;
