-- Removes all CleanSpot demo data (see seed.sql). The demo accounts themselves are deleted
-- through the Auth API by `npm run demo -- remove`; their photo files are removed first.
delete from public.reports
where client_id::text like 'de30de30-%'
   or tenant_id in (select id from public.tenants where slug = 'demo-lk-harburg')
   or reporter_id in (select id from auth.users where email like '%@demo.cleanspot.invalid');
delete from public.tenants where slug = 'demo-lk-harburg';
delete from public.memberships
where user_id in (select id from auth.users where email like '%@demo.cleanspot.invalid');
