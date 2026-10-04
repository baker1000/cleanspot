-- CleanSpot · Migration 7: volunteer bag pickup.
--
-- After a cleanup, the person who cleared the report marks "X bags placed here" with a photo
-- and the location of the bags. That creates a pickup task for the staff of the report's
-- tenant, who collect the bags along a route for the day (ordered on the client, see
-- src/features/pickups/route.ts). Only where a municipality is responsible: in the public
-- area nobody collects bags, so report_bags refuses (CS010) and the app says so up front.
--
-- Error codes added: CS010  no pickup service in this area (public tenant)

alter type public.report_event_type add value if not exists 'bags_reported';
alter type public.report_event_type add value if not exists 'bags_collected';

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
    'kg_per_bag', 6,
    'bag_drop_radius_m', 300,            -- bags may be placed this far from the report (e.g. at a road)
    'max_bags_per_drop', 30
  );
$$;

create type public.pickup_status as enum ('open', 'collected', 'cancelled');

create table public.pickup_tasks (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  location extensions.geography(Point, 4326) not null,
  accuracy_m real,
  distance_to_report_m real,
  bag_count integer not null check (bag_count between 1 and 1000),
  estimated_kg numeric(8, 1),
  photo_id uuid references public.report_photos (id) on delete set null,
  status public.pickup_status not null default 'open',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  collected_by uuid references public.profiles (id) on delete set null,
  collected_at timestamptz,
  constraint collected_iff_status check ((status = 'collected') = (collected_at is not null))
);

create index pickup_tasks_open_idx on public.pickup_tasks (tenant_id, created_at)
  where status = 'open';
create index pickup_tasks_report_idx on public.pickup_tasks (report_id);

-- Estimated kg of a report: from its bags once bags were reported, else from its size.
create function public.refresh_report_kg(p_report_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.reports r
  set estimated_kg = coalesce(
    (select sum(t.estimated_kg) from public.pickup_tasks t
     where t.report_id = r.id and t.status <> 'cancelled'),
    (public.tenant_settings(r.tenant_id) -> 'kg_per_size' ->> r.size::text)::numeric
  )
  where r.id = p_report_id;
$$;

-- "X bags placed here": the person who cleared the report (or staff), with a photo of the bags.
-- Returns the new task id.
create function public.report_bags(
  p_report_id uuid,
  p_bag_count integer,
  p_photo_path text,
  p_lng double precision,
  p_lat double precision,
  p_taken_at timestamptz default null,
  p_accuracy_m real default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_active_user();
  v_report public.reports;
  v_settings jsonb;
  v_point extensions.geography := public.make_point(p_lng, p_lat);
  v_taken_at timestamptz := coalesce(p_taken_at, now());
  v_distance double precision;
  v_photo uuid;
  v_task uuid;
begin
  select * into v_report from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'CS007';
  end if;
  if v_report.status <> 'cleared' then
    raise exception 'Bags can only be reported for cleared reports' using errcode = 'CS001';
  end if;
  if v_report.cleared_by is distinct from v_uid
     and v_report.claimed_by is distinct from v_uid
     and not public.is_tenant_staff(v_report.tenant_id) then
    raise exception 'Only the person who cleared the report can report bags' using errcode = '42501';
  end if;
  if (select t.kind from public.tenants t where t.id = v_report.tenant_id) = 'public' then
    raise exception 'No pickup service in this area' using errcode = 'CS010';
  end if;

  v_settings := public.tenant_settings(v_report.tenant_id);
  if p_bag_count is null or p_bag_count < 1
     or p_bag_count > coalesce((v_settings ->> 'max_bags_per_drop')::int, 30) then
    raise exception 'Invalid number of bags' using errcode = 'CS007';
  end if;
  if v_taken_at > now() + interval '5 minutes' or v_taken_at < v_report.created_at - interval '5 minutes' then
    raise exception 'Invalid photo timestamp' using errcode = 'CS007';
  end if;
  v_distance := extensions.st_distance(v_report.location, v_point);
  if v_distance > (v_settings ->> 'bag_drop_radius_m')::double precision then
    raise exception 'Bags were placed % m from the report (max % m)',
      round(v_distance::numeric), (v_settings ->> 'bag_drop_radius_m')
      using errcode = 'CS002';
  end if;

  v_photo := public.attach_photo(v_report, p_photo_path, 'bags', v_point, v_taken_at, v_distance::real);

  insert into public.pickup_tasks (
    report_id, tenant_id, location, accuracy_m, distance_to_report_m, bag_count, estimated_kg,
    photo_id, created_by
  )
  values (
    v_report.id, v_report.tenant_id, v_point, p_accuracy_m, v_distance::real, p_bag_count,
    p_bag_count * coalesce((v_settings ->> 'kg_per_bag')::numeric, 6), v_photo, v_uid
  )
  returning id into v_task;

  perform public.refresh_report_kg(v_report.id);
  perform public.log_report_event(
    v_report.id, 'bags_reported', null, null, jsonb_build_object('bags', p_bag_count, 'task_id', v_task)
  );
  return v_task;
end;
$$;

-- Staff: bags picked up.
create function public.collect_pickup(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_active_user();
  v_task public.pickup_tasks;
begin
  select * into v_task from public.pickup_tasks where id = p_task_id for update;
  if not found or not public.is_tenant_staff(v_task.tenant_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_task.status <> 'open' then
    raise exception 'Pickup task is %', v_task.status using errcode = 'CS001';
  end if;

  update public.pickup_tasks
  set status = 'collected', collected_by = v_uid, collected_at = now()
  where id = p_task_id;
  perform public.log_report_event(
    v_task.report_id, 'bags_collected', null, null,
    jsonb_build_object('bags', v_task.bag_count, 'task_id', v_task.id)
  );
end;
$$;

-- Creator (while open) or staff: the bags are not there to collect (e.g. reported by mistake).
create function public.cancel_pickup(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_active_user();
  v_task public.pickup_tasks;
begin
  select * into v_task from public.pickup_tasks where id = p_task_id for update;
  if not found
     or (v_task.created_by is distinct from v_uid and not public.is_tenant_staff(v_task.tenant_id)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_task.status <> 'open' then
    raise exception 'Pickup task is %', v_task.status using errcode = 'CS001';
  end if;

  update public.pickup_tasks set status = 'cancelled' where id = p_task_id;
  perform public.refresh_report_kg(v_task.report_id);
end;
$$;

-- Staff: open pickup tasks of a tenant with coordinates, oldest first (input for the route).
create function public.open_pickup_tasks(p_tenant_id uuid)
returns table (
  id uuid,
  report_id uuid,
  lng double precision,
  lat double precision,
  accuracy_m real,
  bag_count integer,
  estimated_kg numeric,
  photo_path text,
  category public.report_category,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_tenant_staff(p_tenant_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select t.id, t.report_id,
           extensions.st_x(t.location::extensions.geometry),
           extensions.st_y(t.location::extensions.geometry),
           t.accuracy_m, t.bag_count, t.estimated_kg, p.storage_path, r.category, t.created_at
    from public.pickup_tasks t
    join public.reports r on r.id = t.report_id
    left join public.report_photos p on p.id = t.photo_id
    where t.tenant_id = p_tenant_id and t.status = 'open'
    order by t.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

alter table public.pickup_tasks enable row level security;

-- The person who reported the bags sees their tasks (detail page); staff see their tenant's.
create policy pickup_tasks_select on public.pickup_tasks
  for select to authenticated
  using (created_by = auth.uid() or public.is_tenant_staff(tenant_id));

revoke all on public.pickup_tasks from anon, authenticated;
grant select on public.pickup_tasks to authenticated;

revoke execute on function public.refresh_report_kg(uuid) from public, anon, authenticated;

revoke execute on function
  public.report_bags(uuid, integer, text, double precision, double precision, timestamptz, real),
  public.collect_pickup(uuid),
  public.cancel_pickup(uuid),
  public.open_pickup_tasks(uuid)
  from public, anon;
grant execute on function
  public.report_bags(uuid, integer, text, double precision, double precision, timestamptz, real),
  public.collect_pickup(uuid),
  public.cancel_pickup(uuid),
  public.open_pickup_tasks(uuid)
  to authenticated;
