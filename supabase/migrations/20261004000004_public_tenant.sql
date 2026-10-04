-- The public tenant receives every report outside a municipality's area (tenant_for_point).
-- Without it, submit_report fails with CS007 everywhere outside a municipality, so every
-- installation needs exactly one. Idempotent: does nothing if a public tenant already exists.
insert into public.tenants (slug, name, kind)
select 'public', 'CleanSpot Community', 'public'
where not exists (select 1 from public.tenants where kind = 'public');
