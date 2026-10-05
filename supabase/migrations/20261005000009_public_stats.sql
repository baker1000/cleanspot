-- CleanSpot · Migration 9: live statistics for the public landing page.
--
-- Aggregate numbers only (no locations, no people), so anyone may read them. Rejected reports
-- and duplicates are not counted. Callable with GET (stable), so the service worker can keep the
-- last answer for the landing page offline.

create function public.public_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reports', count(*) filter (where r.status not in ('rejected', 'duplicate')),
    'open', count(*) filter (where r.status in ('reported', 'confirmed', 'in_progress')),
    'cleared', count(*) filter (where r.status = 'cleared'),
    'cleared_last_30_days',
      count(*) filter (where r.status = 'cleared' and r.cleared_at >= now() - interval '30 days'),
    'kg_cleared', coalesce(round(sum(r.estimated_kg) filter (where r.status = 'cleared')), 0),
    'municipalities', (select count(*) from public.tenants t where t.kind = 'municipality')
  )
  from public.reports r;
$$;

revoke execute on function public.public_stats() from public;
grant execute on function public.public_stats() to anon, authenticated;
