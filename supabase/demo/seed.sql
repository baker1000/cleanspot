-- CleanSpot demo data: Landkreis Harburg (demo municipality) and Hamburg (public area).
--
-- Run by `npm run demo -- seed` (which first creates the demo accounts listed in
-- accounts.json) or by hand as the database owner after creating those accounts. Idempotent:
-- every run starts by removing the previous demo data (see remove.sql, the same statements).
--
-- Recognising demo data:
--   * reports: client_id starts with 'de30de30-' and comment starts with '[Demo]'
--   * tenant:  slug 'demo-lk-harburg'
--   * users:   e-mail ends with '@demo.cleanspot.invalid'
-- Reports are inserted directly (not through submit_report) so that they can have dates in the
-- past and a full history; the history uses the same event types as the real functions.

-- ---------------------------------------------------------------------------
-- Remove the previous demo data (identical to remove.sql, minus deleting the accounts)
-- ---------------------------------------------------------------------------
delete from public.reports
where client_id::text like 'de30de30-%'
   or tenant_id in (select id from public.tenants where slug = 'demo-lk-harburg')
   or reporter_id in (select id from auth.users where email like '%@demo.cleanspot.invalid');
delete from public.tenants where slug = 'demo-lk-harburg';
delete from public.memberships
where user_id in (select id from auth.users where email like '%@demo.cleanspot.invalid');

-- ---------------------------------------------------------------------------
-- Reports: [key, lng, lat, category, hazard, size, status, days ago, reporter, comment,
--           confirmed by, cleared/claimed by, bags, pickup status, published, duplicate of]
-- People are the demo roles: citizen, volunteer, organizer, staff, admin, superadmin.
-- ---------------------------------------------------------------------------
create temp table demo_reports (
  n serial,
  k text primary key,
  lng double precision,
  lat double precision,
  category public.report_category,
  hazard public.hazard_type,
  size public.report_size,
  status public.report_status,
  days numeric,
  reporter text,
  comment text,
  confirmers text[],
  worker text,
  bags integer,
  pickup public.pickup_status,
  published boolean,
  dup_of text
);

insert into demo_reports
  (k, lng, lat, category, hazard, size, status, days, reporter, comment, confirmers, worker, bags,
   pickup, published, dup_of)
values
  -- Landkreis Harburg (demo municipality): Stelle, Winsen, Buchholz, Tostedt, Seevetal, ...
  ('l01', 10.1105, 53.3842, 'bulky', null, 'pile', 'reported', 1.2, 'citizen',
   'Alte Matratze und Stuhl am Feldweg', '{}', null, null, null, true, null),
  ('l02', 10.1162, 53.3871, 'plastic', null, 'bag', 'confirmed', 3.4, null,
   'Mehrere Plastiksäcke im Graben', '{citizen,volunteer}', null, null, null, true, null),
  ('l03', 10.1031, 53.3807, 'construction', null, 'container', 'confirmed', 6.1, 'citizen',
   'Bauschutt hinter dem Parkplatz', '{volunteer,organizer,staff}', null, null, null, true, null),
  ('l04', 10.1228, 53.3795, 'electronics', null, 'pile', 'reported', 0.1, null,
   'Alter Fernseher und Kabel', '{}', null, null, null, false, null),
  ('l05', 10.0989, 53.3889, 'mixed', null, 'bag', 'in_progress', 4.3, 'citizen',
   'Müllbeutel am Waldrand', '{volunteer}', 'volunteer', null, null, true, null),
  ('l06', 10.1274, 53.3912, 'hazardous', 'chemicals', 'bag', 'reported', 2.2, 'citizen',
   'Kanister mit unbekannter Flüssigkeit', '{}', null, null, null, true, null),
  ('l07', 10.0779, 53.3689, 'hazardous', 'batteries', 'pile', 'in_progress', 8.5, null,
   'Batterien und Farbeimer', '{citizen,volunteer}', 'staff', null, null, true, null),
  ('l08', 10.1189, 53.3758, 'bulky', null, 'truck', 'confirmed', 9.2, null,
   'Sofa, Schrank und Teppich', '{citizen,volunteer,organizer,staff}', null, null, null, true, null),
  ('l09', 10.1063, 53.3934, 'mixed', null, 'pile', 'cleared', 12.4, 'citizen',
   'Gemischter Müll an der Bushaltestelle', '{volunteer,organizer,staff}', 'volunteer', 3, 'open',
   true, null),
  ('l10', 10.2105, 53.3577, 'bulky', null, 'pile', 'reported', 2.6, null,
   'Sperrmüll an der Straße in Winsen (Luhe)', '{}', null, null, null, true, null),
  ('l11', 10.2142, 53.3571, 'plastic', null, 'bag', 'cleared', 15.3, 'citizen',
   'Plastikmüll am Luhe-Ufer', '{volunteer,organizer}', 'volunteer', 2, 'open', true, null),
  ('l12', 9.8712, 53.3268, 'mixed', null, 'pile', 'cleared', 6.2, null,
   'Müll am Parkplatz am Waldweg, Buchholz', '{citizen,organizer}', 'organizer', 4, 'open', true,
   null),
  ('l13', 9.7069, 53.2843, 'plastic', null, 'bag', 'cleared', 4.1, 'citizen',
   'Verpackungsmüll an der Bahnhofstraße, Tostedt', '{volunteer}', 'volunteer', 2, 'open', true,
   null),
  ('l14', 10.0428, 53.3944, 'bulky', null, 'pile', 'cleared', 20.5, null,
   'Sperrmüll am Feldweg, Hittfeld', '{citizen,volunteer,organizer}', 'staff', 3, 'collected',
   true, null),
  ('l15', 9.9116, 53.3874, 'plastic', null, 'bag', 'cleared', 10.2, 'citizen',
   'Müll an der Bushaltestelle, Nenndorf', '{volunteer}', 'organizer', 2, 'open', true, null),
  ('l16', 10.1695, 53.2412, 'mixed', null, 'pile', 'cleared', 25.6, null,
   'Müllsäcke am Waldrand, Salzhausen', '{citizen,volunteer,organizer}', 'volunteer', 6,
   'collected', true, null),
  ('l17', 9.9570, 53.3090, 'other', null, 'pile', 'reported', 1.4, null,
   'Autoreifen am Feldrand, Jesteburg', '{}', null, null, null, true, null),
  ('l18', 10.0120, 53.2570, 'construction', null, 'pile', 'confirmed', 7.3, 'citizen',
   'Fliesen und Rigips am Wirtschaftsweg, Hanstedt', '{volunteer,organizer}', null, null, null,
   true, null),
  ('l19', 9.7900, 53.4550, 'hazardous', 'asbestos', 'pile', 'confirmed', 5.2, null,
   'Zerbrochene Wellplatten, vermutlich Asbest', '{citizen}', null, null, null, true, null),
  ('l20', 10.1107, 53.3843, 'bulky', null, 'pile', 'duplicate', 1.1, null,
   'Matratze am Feldweg', '{}', null, null, null, true, 'l01'),
  ('l21', 10.1350, 53.3850, 'other', null, 'bag', 'rejected', 3.3, null,
   'Nur Laub, kein Müll', '{}', null, null, null, false, null),
  ('l22', 10.0835, 53.3712, 'mixed', null, 'bag', 'cleared', 2.1, 'citizen',
   'Müll am Radweg Richtung Ashausen', '{}', 'volunteer', null, null, true, null),
  -- Hamburg (outside every municipality of this install: public area, community clears)
  ('h01', 9.9370, 53.5450, 'plastic', null, 'bag', 'reported', 0.2, 'citizen',
   'Plastikflaschen und Tüten am Elbstrand', '{}', null, null, null, false, null),
  ('h02', 9.9905, 53.4985, 'mixed', null, 'pile', 'confirmed', 2.3, null,
   'Müll am Rand des Inselparks, Wilhelmsburg', '{citizen,organizer}', null, null, null, true,
   null),
  ('h03', 10.0135, 53.5380, 'bulky', null, 'pile', 'in_progress', 4.4, 'citizen',
   'Sperrmüll an der Bille', '{organizer}', 'volunteer', null, null, true, null),
  ('h04', 9.9790, 53.5610, 'plastic', null, 'bag', 'cleared', 9.1, null,
   'Verpackungen im Gebüsch', '{citizen,volunteer,organizer}', 'volunteer', null, null, true,
   null),
  ('h05', 10.1150, 53.5395, 'electronics', null, 'pile', 'reported', 1.3, 'citizen',
   'Kühlschrank am Gehweg, Billstedt', '{}', null, null, null, true, null),
  ('h06', 10.2120, 53.4880, 'construction', null, 'pile', 'confirmed', 5.4, null,
   'Bauschutt am Deich, Bergedorf', '{organizer,volunteer}', null, null, null, true, null),
  ('h07', 9.8530, 53.4760, 'hazardous', 'needles', 'bag', 'reported', 1.5, null,
   'Spritzen in der Nähe des Spielplatzes', '{}', null, null, null, true, null),
  ('h08', 9.9715, 53.5655, 'mixed', null, 'bag', 'cleared', 20.2, 'citizen',
   'Müll nach dem Grillen im Park', '{volunteer,organizer}', 'organizer', null, null, true, null),
  ('h09', 9.9880, 53.4560, 'mixed', null, 'pile', 'cleared', 30.3, null,
   'Müll am Teich im Stadtpark Harburg', '{citizen,volunteer,organizer}', 'organizer', null, null,
   true, null),
  ('h10', 10.0300, 53.5900, 'plastic', null, 'bag', 'rejected', 3.2, null,
   'Bild zeigt keinen Müll', '{}', null, null, null, false, null);

-- ---------------------------------------------------------------------------
-- Tenant, people, reports, history, pickups
-- ---------------------------------------------------------------------------
do $$
declare
  v_people jsonb := '{}'::jsonb;
  v_missing text;
  v_public uuid;
  v_demo uuid;
  r record;
  v_id uuid;
  v_ids jsonb := '{}'::jsonb;
  v_t0 timestamptz;
  v_work timestamptz;
  v_point extensions.geography;
  v_reporter uuid;
  v_worker uuid;
  v_i integer;
  v_task uuid;
  v_staff_or_admin uuid;
begin
  -- The demo accounts (created beforehand through the Auth API).
  select string_agg(a.email, ', ') into v_missing
  from (values ('citizen'), ('volunteer'), ('organizer'), ('staff'), ('admin'), ('superadmin'))
       as x(role)
  cross join lateral (select x.role || '@demo.cleanspot.invalid' as email) a
  where not exists (select 1 from auth.users u where u.email = a.email);
  if v_missing is not null then
    raise exception 'Demo accounts missing: % (create them first: npm run demo -- seed)', v_missing;
  end if;
  select jsonb_object_agg(split_part(u.email, '@', 1), u.id) into v_people
  from auth.users u where u.email like '%@demo.cleanspot.invalid';

  select id into v_public from public.tenants where kind = 'public';
  if v_public is null then
    insert into public.tenants (slug, name, kind) values ('public', 'CleanSpot', 'public')
    returning id into v_public;
  end if;

  -- Rough outline of Landkreis Harburg (lng lat), leaving Hamburg out. Not the official border.
  insert into public.tenants (slug, name, kind, area, settings, contact_email)
  values (
    'demo-lk-harburg', 'Landkreis Harburg (Demo)', 'municipality',
    'SRID=4326;MULTIPOLYGON(((9.64 53.47, 9.8 53.48, 9.93 53.43, 10.05 53.43, 10.15 53.41,
      10.26 53.42, 10.38 53.43, 10.36 53.33, 10.28 53.25, 10.17 53.19, 10.02 53.17, 9.88 53.17,
      9.76 53.2, 9.66 53.27, 9.62 53.36, 9.64 53.47)))'::extensions.geography,
    '{}'::jsonb,
    'umwelt@demo.cleanspot.invalid'
  )
  returning id into v_demo;

  update public.profiles p
  set display_name = case split_part(u.email, '@', 1)
        when 'citizen' then 'Clara Bürger'
        when 'volunteer' then 'Vincent Helfer'
        when 'organizer' then 'Olivia Aktiv'
        when 'staff' then 'Stefan Bauhof'
        when 'admin' then 'Anna Umweltamt'
        when 'superadmin' then 'Sam Betrieb'
      end,
      is_super_admin = (split_part(u.email, '@', 1) = 'superadmin'),
      blocked_until = null
  from auth.users u
  where u.id = p.id and u.email like '%@demo.cleanspot.invalid';

  insert into public.memberships (user_id, tenant_id, role)
  values
    ((v_people ->> 'volunteer')::uuid, v_public, 'volunteer'),
    ((v_people ->> 'organizer')::uuid, v_public, 'organizer'),
    ((v_people ->> 'staff')::uuid, v_demo, 'municipality_staff'),
    ((v_people ->> 'admin')::uuid, v_demo, 'municipality_admin');

  for r in select * from demo_reports order by n loop
    v_point := extensions.st_setsrid(extensions.st_makepoint(r.lng, r.lat), 4326)::extensions.geography;
    v_t0 := now() - make_interval(secs => (r.days * 86400)::double precision);
    v_reporter := (v_people ->> r.reporter)::uuid;
    v_worker := (v_people ->> r.worker)::uuid;
    -- Cleared about halfway between reporting and now, at least 2 hours ago.
    v_work := v_t0 + least((now() - v_t0) / 2, (now() - v_t0) - interval '2 hours');

    insert into public.reports (
      client_id, tenant_id, reporter_id, location, accuracy_m, category, hazard_type, size,
      comment, status, duplicate_of, is_published, confirmation_count, estimated_kg,
      claimed_by, claimed_at, cleared_by, cleared_at, created_at, updated_at
    )
    select
      ('de30de30-0000-4000-8000-' || lpad(r.n::text, 12, '0'))::uuid,
      public.tenant_for_point(v_point), v_reporter, v_point, 8, r.category, r.hazard, r.size,
      '[Demo] ' || r.comment, r.status, (v_ids ->> r.dup_of)::uuid,
      r.published or coalesce(array_length(r.confirmers, 1), 0) >= 3,
      coalesce(array_length(r.confirmers, 1), 0),
      (public.tenant_settings(public.tenant_for_point(v_point)) -> 'kg_per_size' ->> r.size::text)::numeric,
      case when r.status in ('in_progress', 'cleared') then v_worker end,
      case when r.status = 'in_progress' then v_t0 + (now() - v_t0) / 2
           when r.status = 'cleared' then v_work - interval '2 hours' end,
      case when r.status = 'cleared' then v_worker end,
      case when r.status = 'cleared' then v_work end,
      v_t0,
      greatest(v_t0, coalesce(case when r.status = 'cleared' then v_work end, v_t0))
    returning id into v_id;
    v_ids := v_ids || jsonb_build_object(r.k, v_id);

    insert into public.report_events (report_id, actor_id, type, to_status, created_at)
    values (v_id, v_reporter, 'created', 'reported', v_t0);

    for v_i in 1 .. coalesce(array_length(r.confirmers, 1), 0) loop
      insert into public.report_confirmations (report_id, user_id, created_at)
      values (v_id, (v_people ->> r.confirmers[v_i])::uuid, v_t0 + make_interval(hours => 2 * v_i));
      insert into public.report_events (report_id, actor_id, type, data, created_at)
      values (v_id, (v_people ->> r.confirmers[v_i])::uuid, 'confirmed',
              jsonb_build_object('count', v_i), v_t0 + make_interval(hours => 2 * v_i));
      if v_i = 3 then
        insert into public.report_events (report_id, type, data, created_at)
        values (v_id, 'published', '{"reason": "confirmations"}',
                v_t0 + make_interval(hours => 2 * v_i));
      end if;
    end loop;

    if r.status = 'in_progress' then
      insert into public.report_events (report_id, actor_id, type, from_status, to_status, created_at)
      values (v_id, v_worker, 'claimed',
              case when coalesce(array_length(r.confirmers, 1), 0) > 0 then 'confirmed' else 'reported' end::public.report_status,
              'in_progress', v_t0 + (now() - v_t0) / 2);
    elsif r.status = 'cleared' then
      insert into public.report_events (report_id, actor_id, type, from_status, to_status, created_at)
      values (v_id, v_worker, 'claimed',
              case when coalesce(array_length(r.confirmers, 1), 0) > 0 then 'confirmed' else 'reported' end::public.report_status,
              'in_progress', v_work - interval '2 hours');
      insert into public.report_events (report_id, actor_id, type, from_status, to_status, data, created_at)
      values (v_id, v_worker, 'cleared', 'in_progress', 'cleared',
              jsonb_build_object('distance_m', 12.5, 'taken_at', v_work, 'accuracy_m', 6), v_work);
    elsif r.status in ('rejected', 'duplicate') then
      -- Decided by the municipality, or in the public area by the operator (super admin).
      v_staff_or_admin := case when public.tenant_for_point(v_point) = v_demo
                               then (v_people ->> 'admin')::uuid
                               else (v_people ->> 'superadmin')::uuid end;
      insert into public.report_events (report_id, actor_id, type, from_status, to_status, data, created_at)
      values (v_id, v_staff_or_admin,
              case when r.status = 'duplicate' then 'marked_duplicate' else 'status_changed' end::public.report_event_type,
              'reported', r.status,
              case when r.status = 'duplicate'
                   then jsonb_build_object('original_id', v_ids ->> r.dup_of) else '{}'::jsonb end,
              v_t0 + interval '3 hours');
    end if;

    if r.bags is not null then
      -- Bags left 25 m east of the spot, as a volunteer would put them at the road.
      insert into public.pickup_tasks (
        report_id, tenant_id, location, accuracy_m, distance_to_report_m, bag_count,
        estimated_kg, status, created_by, created_at, collected_by, collected_at
      )
      values (
        v_id, public.tenant_for_point(v_point),
        extensions.st_project(v_point, 25, radians(90)), 8, 25, r.bags,
        r.bags * (public.tenant_settings(v_demo) ->> 'kg_per_bag')::numeric,
        r.pickup, v_worker, v_work + interval '15 minutes',
        case when r.pickup = 'collected' then (v_people ->> 'staff')::uuid end,
        case when r.pickup = 'collected' then v_work + interval '1 day' end
      )
      returning id into v_task;
      insert into public.report_events (report_id, actor_id, type, data, created_at)
      values (v_id, v_worker, 'bags_reported',
              jsonb_build_object('bags', r.bags, 'task_id', v_task), v_work + interval '15 minutes');
      if r.pickup = 'collected' then
        insert into public.report_events (report_id, actor_id, type, data, created_at)
        values (v_id, (v_people ->> 'staff')::uuid, 'bags_collected',
                jsonb_build_object('bags', r.bags, 'task_id', v_task), v_work + interval '1 day');
      end if;
      perform public.refresh_report_kg(v_id);
    end if;
  end loop;
end;
$$;

drop table demo_reports;
