-- CleanSpot · Migration 6: which tenant would receive a report at this point?
--
-- The report form uses it before submitting: for hazardous waste outside every municipality it
-- tells the reporter to contact the local authority, inside one it names the municipality.
-- Same routing as submit_report (public.tenant_for_point). Tenant names and settings are
-- already public (tenants_select policy), so this exposes nothing new.

create function public.tenant_at_point(p_lng double precision, p_lat double precision)
returns table (
  tenant_id uuid,
  kind public.tenant_kind,
  name text,
  bulky_waste_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.kind, t.name, public.tenant_settings(t.id) ->> 'bulky_waste_url'
  from public.tenants t
  where t.id = public.tenant_for_point(public.make_point(p_lng, p_lat));
$$;

revoke execute on function public.tenant_at_point(double precision, double precision) from public;
grant execute on function public.tenant_at_point(double precision, double precision)
  to anon, authenticated;
