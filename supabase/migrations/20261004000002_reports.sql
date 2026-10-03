-- CleanSpot · Migration 2: reports, photos, timeline, confirmations, workflow RPCs, photo storage.
--
-- Write model
--   Clients never INSERT/UPDATE these tables directly. Every change goes through a
--   SECURITY DEFINER function below, which checks permissions and the status machine
--   and writes a timeline event. Direct table grants are SELECT only (RLS-filtered).
--
-- Read model
--   * reports / report_photos / report_events: RLS-filtered base tables for the reporter,
--     the claimer and tenant staff.
--   * reports_public / report_photos_public / report_events_public: views for everyone
--     (incl. anon) that hide personal data and unpublished content.
--
-- Error codes (SQLSTATE) raised by the RPCs, matched by the client:
--   42501  not allowed (permission)          PT429  rate limit (PostgREST -> HTTP 429)
--   CS001  invalid status transition         CS002  too far from report location
--   CS003  already claimed by someone else   CS004  hazardous: staff only
--   CS005  photo missing or invalid path     CS006  photo limit reached
--   CS007  invalid input                     CS008  cannot confirm (own report / anonymous)
--   CS009  sign-in required

-- ---------------------------------------------------------------------------
-- Settings: add keys introduced by this migration
-- ---------------------------------------------------------------------------

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
    'reports_per_hour_anonymous', 5,
    'reports_per_hour_registered', 20,
    'bulky_waste_url', null,             -- link to local bulky-waste booking
    'kg_per_size', jsonb_build_object('bag', 5, 'pile', 40, 'container', 300, 'truck', 1500),
    'kg_per_bag', 6
  );
$$;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.report_category as enum (
  'plastic', 'construction', 'electronics', 'mixed', 'bulky', 'hazardous', 'other'
);
create type public.hazard_type as enum (
  'batteries', 'chemicals', 'asbestos', 'needles', 'oil', 'other'
);
create type public.report_size as enum ('bag', 'pile', 'container', 'truck');
create type public.report_status as enum (
  'reported', 'confirmed', 'in_progress', 'cleared', 'rejected', 'duplicate'
);
create type public.photo_kind as enum ('before', 'after', 'bags');
create type public.moderation_status as enum ('pending', 'approved', 'rejected');
create type public.report_event_type as enum (
  'created', 'confirmed', 'claimed', 'unclaimed', 'cleared', 'status_changed',
  'marked_duplicate', 'photo_added', 'photo_approved', 'photo_rejected', 'published'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  -- Generated on the device; makes offline sync idempotent.
  client_id uuid not null unique,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  reporter_id uuid references public.profiles (id) on delete set null,
  location extensions.geography(Point, 4326) not null,
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  category public.report_category not null,
  hazard_type public.hazard_type,
  is_hazardous boolean generated always as (category = 'hazardous') stored,
  size public.report_size not null,
  comment text check (comment is null or length(comment) <= 500),
  status public.report_status not null default 'reported',
  duplicate_of uuid references public.reports (id) on delete set null,
  -- Published = photos and comment may be shown publicly (after review or N confirmations).
  is_published boolean not null default false,
  confirmation_count integer not null default 0 check (confirmation_count >= 0),
  estimated_kg numeric(8, 1),
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  assigned_to uuid references public.profiles (id) on delete set null,
  cleared_by uuid references public.profiles (id) on delete set null,
  cleared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hazard_type_iff_hazardous check ((category = 'hazardous') = (hazard_type is not null)),
  constraint duplicate_requires_original check (status <> 'duplicate' or duplicate_of is not null),
  constraint not_duplicate_of_self check (duplicate_of is distinct from id)
);

create index reports_location_gix on public.reports using gist (location);
create index reports_tenant_status_idx on public.reports (tenant_id, status);
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index reports_created_idx on public.reports (created_at desc);

create trigger reports_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

create table public.report_photos (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  kind public.photo_kind not null,
  storage_path text not null unique,
  uploaded_by uuid references public.profiles (id) on delete set null,
  taken_at timestamptz not null default now(),
  location extensions.geography(Point, 4326),
  distance_to_report_m real,
  moderation public.moderation_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index report_photos_report_idx on public.report_photos (report_id, kind);
create index report_photos_pending_idx on public.report_photos (moderation) where moderation = 'pending';

create table public.report_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  type public.report_event_type not null,
  from_status public.report_status,
  to_status public.report_status,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index report_events_report_idx on public.report_events (report_id, created_at);

create table public.report_confirmations (
  report_id uuid not null references public.reports (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by API roles)
-- ---------------------------------------------------------------------------

create function public.is_anonymous_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

create function public.make_point(p_lng double precision, p_lat double precision)
returns extensions.geography
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_lng is null or p_lat is null or p_lng not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'Invalid coordinates' using errcode = 'CS007';
  end if;
  return extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
end;
$$;

create function public.log_report_event(
  p_report_id uuid,
  p_type public.report_event_type,
  p_from public.report_status default null,
  p_to public.report_status default null,
  p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.report_events (report_id, actor_id, type, from_status, to_status, data)
  values (p_report_id, auth.uid(), p_type, p_from, p_to, coalesce(p_data, '{}'::jsonb));
$$;

create function public.require_active_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign-in required' using errcode = 'CS009';
  end if;
  if public.is_blocked() then
    raise exception 'Account is blocked' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- May the current user claim / clear reports in this tenant?
--   * tenant staff (and super admins): always, including hazardous reports
--   * hazardous reports: nobody else
--   * otherwise: registered (non-anonymous, not blocked) users who are a member of the
--     report's tenant or a volunteer of the public tenant, if the tenant allows volunteers.
create function public.can_work_on_report(p_tenant_id uuid, p_is_hazardous boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_tenant_staff(p_tenant_id) then true
    when p_is_hazardous then false
    when auth.uid() is null or public.is_anonymous_user() or public.is_blocked() then false
    else coalesce((public.tenant_settings(p_tenant_id) ->> 'allow_volunteer_claims')::boolean, true)
      and (
        public.tenant_role(p_tenant_id) is not null
        or exists (
          select 1
          from public.memberships m
          join public.tenants t on t.id = m.tenant_id
          where m.user_id = auth.uid() and t.kind = 'public'
        )
      )
  end;
$$;

-- Validates an uploaded object and links it to a report.
-- Path format: <uploader uid>/<uuid>.<webp|jpg>, in bucket report-photos.
create function public.attach_photo(
  p_report public.reports,
  p_path text,
  p_kind public.photo_kind,
  p_location extensions.geography default null,
  p_taken_at timestamptz default null,
  p_distance_m real default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if p_path is null
     or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$'
     or split_part(p_path, '/', 1) <> v_uid::text then
    raise exception 'Invalid photo path' using errcode = 'CS005';
  end if;
  if not exists (
    select 1 from storage.objects o where o.bucket_id = 'report-photos' and o.name = p_path
  ) then
    raise exception 'Photo not uploaded' using errcode = 'CS005';
  end if;
  if exists (select 1 from public.report_photos p where p.storage_path = p_path) then
    raise exception 'Photo already attached' using errcode = 'CS005';
  end if;
  if (select count(*) from public.report_photos p where p.report_id = p_report.id and p.kind = p_kind) >= 3 then
    raise exception 'Photo limit reached' using errcode = 'CS006';
  end if;

  insert into public.report_photos (
    report_id, kind, storage_path, uploaded_by, taken_at, location, distance_to_report_m, moderation,
    reviewed_by, reviewed_at
  )
  values (
    p_report.id, p_kind, p_path, v_uid, coalesce(p_taken_at, now()), p_location, p_distance_m,
    -- Photos by tenant staff need no review.
    case when public.is_tenant_staff(p_report.tenant_id) then 'approved' else 'pending' end::public.moderation_status,
    case when public.is_tenant_staff(p_report.tenant_id) then v_uid end,
    case when public.is_tenant_staff(p_report.tenant_id) then now() end
  )
  returning id into v_id;

  perform public.log_report_event(p_report.id, 'photo_added', null, null, jsonb_build_object('kind', p_kind));
  return v_id;
end;
$$;

-- Approves pending "before" photos and publishes the report.
create function public.publish_report(p_report_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.report_photos
  set moderation = 'approved', reviewed_at = now()
  where report_id = p_report_id and kind = 'before' and moderation = 'pending';

  update public.reports set is_published = true where id = p_report_id and not is_published;
  if found then
    perform public.log_report_event(p_report_id, 'published', null, null, jsonb_build_object('reason', p_reason));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- Creates a report. Idempotent per client_id (safe to retry from the offline queue).
-- Anonymous reporting = Supabase anonymous sign-in; a JWT with a sub is always required.
create function public.submit_report(
  p_client_id uuid,
  p_lng double precision,
  p_lat double precision,
  p_category public.report_category,
  p_size public.report_size,
  p_hazard_type public.hazard_type default null,
  p_comment text default null,
  p_accuracy_m real default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_active_user();
  v_existing public.reports;
  v_point extensions.geography;
  v_tenant uuid;
  v_settings jsonb;
  v_limit int;
  v_id uuid;
  v_hazard public.hazard_type;
begin
  if p_client_id is null or p_category is null or p_size is null then
    raise exception 'client_id, category and size are required' using errcode = 'CS007';
  end if;

  select * into v_existing from public.reports where client_id = p_client_id;
  if found then
    if v_existing.reporter_id is distinct from v_uid then
      raise exception 'client_id already in use' using errcode = 'CS007';
    end if;
    return v_existing.id;
  end if;

  v_point := public.make_point(p_lng, p_lat);
  v_tenant := public.tenant_for_point(v_point);
  if v_tenant is null then
    raise exception 'No tenant configured for this location' using errcode = 'CS007';
  end if;
  v_settings := public.tenant_settings(v_tenant);

  v_limit := case
    when public.is_anonymous_user() then (v_settings ->> 'reports_per_hour_anonymous')::int
    else (v_settings ->> 'reports_per_hour_registered')::int
  end;
  if (
    select count(*) from public.reports r
    where r.reporter_id = v_uid and r.created_at > now() - interval '1 hour'
  ) >= v_limit then
    raise exception 'Too many reports, please try again later' using errcode = 'PT429';
  end if;

  v_hazard := case when p_category = 'hazardous' then coalesce(p_hazard_type, 'other') end;

  insert into public.reports (
    client_id, tenant_id, reporter_id, location, accuracy_m, category, hazard_type, size, comment,
    estimated_kg
  )
  values (
    p_client_id, v_tenant, v_uid, v_point, p_accuracy_m, p_category, v_hazard, p_size,
    nullif(btrim(p_comment), ''),
    (v_settings -> 'kg_per_size' ->> p_size::text)::numeric
  )
  returning id into v_id;

  perform public.log_report_event(v_id, 'created', null, 'reported');
  return v_id;
end;
$$;

-- Attaches a "before" photo (already uploaded to storage) to a report.
create function public.add_report_photo(p_report_id uuid, p_path text, p_taken_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_active_user();
  v_report public.reports;
begin
  select * into v_report from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'CS007';
  end if;
  if v_report.reporter_id is distinct from v_uid and not public.is_tenant_staff(v_report.tenant_id) then
    raise exception 'Only the reporter can add photos' using errcode = '42501';
  end if;
  if v_report.status not in ('reported', 'confirmed', 'in_progress') then
    raise exception 'Report is closed' using errcode = 'CS001';
  end if;
  return public.attach_photo(v_report, p_path, 'before', null, p_taken_at, null);
end;
$$;

-- Open reports near a point, for the duplicate warning. Radius defaults to the tenant setting.
create function public.find_nearby_open_reports(
  p_lng double precision,
  p_lat double precision,
  p_radius_m double precision default null
)
returns table (
  id uuid,
  distance_m double precision,
  category public.report_category,
  status public.report_status,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_point extensions.geography := public.make_point(p_lng, p_lat);
  v_radius double precision;
begin
  v_radius := least(
    coalesce(
      p_radius_m,
      (public.tenant_settings(public.tenant_for_point(v_point)) ->> 'duplicate_radius_m')::double precision,
      30
    ),
    500
  );
  return query
    select r.id, extensions.st_distance(r.location, v_point), r.category, r.status, r.created_at
    from public.reports r
    where r.status in ('reported', 'confirmed', 'in_progress')
      and extensions.st_dwithin(r.location, v_point, v_radius)
    order by 2
    limit 20;
end;
$$;

-- Community confirmation ("I see this too"). Registered users only, not the reporter.
-- Returns the new confirmation count. Idempotent.
create function public.confirm_report(p_report_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_active_user();
  v_report public.reports;
  v_threshold int;
begin
  if public.is_anonymous_user() then
    raise exception 'Please create an account to confirm reports' using errcode = 'CS008';
  end if;
  select * into v_report from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'CS007';
  end if;
  if v_report.reporter_id = v_uid then
    raise exception 'You cannot confirm your own report' using errcode = 'CS008';
  end if;
  if v_report.status not in ('reported', 'confirmed') then
    raise exception 'Report cannot be confirmed in status %', v_report.status using errcode = 'CS001';
  end if;

  insert into public.report_confirmations (report_id, user_id) values (p_report_id, v_uid)
  on conflict do nothing;
  if not found then
    return v_report.confirmation_count;
  end if;

  update public.reports
  set confirmation_count = confirmation_count + 1,
      status = case when status = 'reported' then 'confirmed'::public.report_status else status end
  where id = p_report_id
  returning * into v_report;

  perform public.log_report_event(
    p_report_id, 'confirmed', null, null, jsonb_build_object('count', v_report.confirmation_count)
  );

  v_threshold := (public.tenant_settings(v_report.tenant_id) ->> 'auto_approve_confirmations')::int;
  if v_threshold is not null and v_report.confirmation_count >= v_threshold then
    perform public.publish_report(p_report_id, 'confirmations');
  end if;

  return v_report.confirmation_count;
end;
$$;

-- "I'll clear this."
create function public.claim_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_active_user();
  v_report public.reports;
begin
  select * into v_report from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'CS007';
  end if;
  if v_report.status = 'in_progress' and v_report.claimed_by is distinct from v_uid then
    raise exception 'Already claimed' using errcode = 'CS003';
  end if;
  if v_report.status not in ('reported', 'confirmed') then
    raise exception 'Report cannot be claimed in status %', v_report.status using errcode = 'CS001';
  end if;
  if not public.can_work_on_report(v_report.tenant_id, v_report.is_hazardous) then
    if v_report.is_hazardous then
      raise exception 'Hazardous waste is handled by municipality staff only' using errcode = 'CS004';
    end if;
    raise exception 'Not allowed to claim this report' using errcode = '42501';
  end if;

  update public.reports
  set status = 'in_progress', claimed_by = v_uid, claimed_at = now()
  where id = p_report_id;

  perform public.log_report_event(p_report_id, 'claimed', v_report.status, 'in_progress');
end;
$$;

-- Give a claim back (claimer or staff).
create function public.unclaim_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_active_user();
  v_report public.reports;
  v_to public.report_status;
begin
  select * into v_report from public.reports where id = p_report_id for update;
  if not found or v_report.status <> 'in_progress' then
    raise exception 'Report is not in progress' using errcode = 'CS001';
  end if;
  if v_report.claimed_by is distinct from v_uid and not public.is_tenant_staff(v_report.tenant_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  v_to := case when v_report.confirmation_count > 0 then 'confirmed' else 'reported' end;
  update public.reports
  set status = v_to, claimed_by = null, claimed_at = null
  where id = p_report_id;

  perform public.log_report_event(p_report_id, 'unclaimed', 'in_progress', v_to);
end;
$$;

-- Marks a report as cleared with an "after" photo taken near the report location.
-- An unclaimed report is claimed implicitly. Returns { photo_id, distance_m }.
create function public.submit_cleanup(
  p_report_id uuid,
  p_photo_path text,
  p_lng double precision,
  p_lat double precision,
  p_taken_at timestamptz default null,
  p_accuracy_m real default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_active_user();
  v_report public.reports;
  v_point extensions.geography := public.make_point(p_lng, p_lat);
  v_taken_at timestamptz := coalesce(p_taken_at, now());
  v_radius double precision;
  v_distance double precision;
  v_photo uuid;
begin
  select * into v_report from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'CS007';
  end if;
  if v_report.status not in ('reported', 'confirmed', 'in_progress') then
    raise exception 'Report cannot be cleared in status %', v_report.status using errcode = 'CS001';
  end if;
  if v_report.status = 'in_progress'
     and v_report.claimed_by is distinct from v_uid
     and not public.is_tenant_staff(v_report.tenant_id) then
    raise exception 'Already claimed' using errcode = 'CS003';
  end if;
  if not public.can_work_on_report(v_report.tenant_id, v_report.is_hazardous) then
    if v_report.is_hazardous then
      raise exception 'Hazardous waste is handled by municipality staff only' using errcode = 'CS004';
    end if;
    raise exception 'Not allowed to clear this report' using errcode = '42501';
  end if;
  -- Offline sync may deliver the photo later, but it cannot be taken before the report
  -- existed or in the future (5 min clock-skew tolerance).
  if v_taken_at > now() + interval '5 minutes' or v_taken_at < v_report.created_at - interval '5 minutes' then
    raise exception 'Invalid photo timestamp' using errcode = 'CS007';
  end if;

  v_radius := (public.tenant_settings(v_report.tenant_id) ->> 'cleanup_radius_m')::double precision;
  v_distance := extensions.st_distance(v_report.location, v_point);
  if v_distance > v_radius then
    raise exception 'After-photo was taken % m from the report (max % m)', round(v_distance::numeric), v_radius
      using errcode = 'CS002';
  end if;

  v_photo := public.attach_photo(v_report, p_photo_path, 'after', v_point, v_taken_at, v_distance::real);

  update public.reports
  set status = 'cleared',
      cleared_by = v_uid,
      cleared_at = now(),
      claimed_by = coalesce(claimed_by, v_uid),
      claimed_at = coalesce(claimed_at, now())
  where id = p_report_id;

  perform public.log_report_event(
    p_report_id, 'cleared', v_report.status, 'cleared',
    jsonb_build_object('distance_m', round(v_distance::numeric, 1), 'taken_at', v_taken_at, 'accuracy_m', p_accuracy_m)
  );

  return jsonb_build_object('photo_id', v_photo, 'distance_m', round(v_distance::numeric, 1));
end;
$$;

-- Staff: approve or reject a photo. Approving a "before" photo publishes the report.
create function public.moderate_photo(p_photo_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.report_photos;
  v_tenant uuid;
begin
  perform public.require_active_user();
  select p.* into v_photo from public.report_photos p where p.id = p_photo_id for update;
  if not found then
    raise exception 'Photo not found' using errcode = 'CS007';
  end if;
  select r.tenant_id into v_tenant from public.reports r where r.id = v_photo.report_id;
  if not public.is_tenant_staff(v_tenant) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  update public.report_photos
  set moderation = case when p_approve then 'approved' else 'rejected' end::public.moderation_status,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_photo_id;

  perform public.log_report_event(
    v_photo.report_id,
    case when p_approve then 'photo_approved' else 'photo_rejected' end::public.report_event_type,
    null, null, jsonb_build_object('photo_id', p_photo_id)
  );

  if p_approve and v_photo.kind = 'before' then
    perform public.publish_report(v_photo.report_id, 'review');
  end if;
end;
$$;

-- Staff: set any status except "duplicate" (use mark_duplicate).
create function public.set_report_status(
  p_report_id uuid,
  p_status public.report_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_active_user();
  v_report public.reports;
begin
  select * into v_report from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'CS007';
  end if;
  if not public.is_tenant_staff(v_report.tenant_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status = 'duplicate' then
    raise exception 'Use mark_duplicate' using errcode = 'CS001';
  end if;
  if p_status = v_report.status then
    return;
  end if;

  update public.reports
  set status = p_status,
      duplicate_of = null,
      claimed_by = case when p_status in ('reported', 'confirmed', 'rejected') then null else claimed_by end,
      claimed_at = case when p_status in ('reported', 'confirmed', 'rejected') then null else claimed_at end,
      cleared_by = case when p_status = 'cleared' then coalesce(cleared_by, v_uid) end,
      cleared_at = case when p_status = 'cleared' then coalesce(cleared_at, now()) end
  where id = p_report_id;

  perform public.log_report_event(
    p_report_id, 'status_changed', v_report.status, p_status, jsonb_build_object('reason', p_reason)
  );
end;
$$;

-- Staff: mark a report as duplicate of another (open or closed, but not itself a duplicate).
create function public.mark_duplicate(p_report_id uuid, p_original_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.reports;
  v_original public.reports;
begin
  perform public.require_active_user();
  select * into v_report from public.reports where id = p_report_id for update;
  select * into v_original from public.reports where id = p_original_id;
  if v_report.id is null or v_original.id is null or p_report_id = p_original_id then
    raise exception 'Report not found' using errcode = 'CS007';
  end if;
  if not public.is_tenant_staff(v_report.tenant_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_original.status = 'duplicate' then
    raise exception 'Original is itself a duplicate' using errcode = 'CS001';
  end if;

  update public.reports
  set status = 'duplicate', duplicate_of = p_original_id, claimed_by = null, claimed_at = null
  where id = p_report_id;

  perform public.log_report_event(
    p_report_id, 'marked_duplicate', v_report.status, 'duplicate', jsonb_build_object('original_id', p_original_id)
  );
end;
$$;

-- Photo read access, used by the storage policy.
create function public.can_read_photo(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(p_path, '/', 1) = auth.uid()::text
    or exists (
      select 1
      from public.report_photos p
      join public.reports r on r.id = p.report_id
      where p.storage_path = p_path
        and (
          (p.moderation = 'approved' and r.status not in ('rejected', 'duplicate'))
          or p.uploaded_by = auth.uid()
          or public.is_tenant_staff(r.tenant_id)
        )
    );
$$;

-- ---------------------------------------------------------------------------
-- Public views (run with owner rights; expose only non-personal, published data)
-- ---------------------------------------------------------------------------

create view public.reports_public
with (security_invoker = false)
as
  select
    r.id,
    r.tenant_id,
    extensions.st_x(r.location::extensions.geometry) as lng,
    extensions.st_y(r.location::extensions.geometry) as lat,
    r.category,
    r.hazard_type,
    r.is_hazardous,
    r.size,
    r.status,
    case when r.is_published then r.comment end as comment,
    r.is_published,
    r.confirmation_count,
    r.estimated_kg,
    r.claimed_by is not null as is_claimed,
    coalesce(r.claimed_by = auth.uid(), false) as claimed_by_me,
    coalesce(r.reporter_id = auth.uid(), false) as reported_by_me,
    r.created_at,
    r.updated_at,
    r.cleared_at
  from public.reports r
  where r.status not in ('rejected', 'duplicate');

create view public.report_photos_public
with (security_invoker = false)
as
  select p.id, p.report_id, p.kind, p.storage_path, p.taken_at, p.created_at
  from public.report_photos p
  join public.reports r on r.id = p.report_id
  where p.moderation = 'approved' and r.status not in ('rejected', 'duplicate');

create view public.report_events_public
with (security_invoker = false)
as
  select e.id, e.report_id, e.type, e.from_status, e.to_status, e.created_at
  from public.report_events e
  join public.reports r on r.id = e.report_id
  where r.status not in ('rejected', 'duplicate')
    and e.type not in ('photo_rejected');

-- Map query: published-safe reports inside a bounding box.
create function public.reports_in_bbox(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_statuses public.report_status[] default null,
  p_limit integer default 2000
)
returns setof public.reports_public
language sql
stable
set search_path = ''
as $$
  select v.*
  from public.reports_public v
  where v.lng between p_min_lng and p_max_lng
    and v.lat between p_min_lat and p_max_lat
    and (p_statuses is null or v.status = any (p_statuses))
  order by v.created_at desc
  limit least(greatest(coalesce(p_limit, 2000), 1), 5000);
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security on base tables (SELECT only; writes go through RPCs)
-- ---------------------------------------------------------------------------

alter table public.reports enable row level security;
alter table public.report_photos enable row level security;
alter table public.report_events enable row level security;
alter table public.report_confirmations enable row level security;

create policy reports_select on public.reports
  for select to authenticated
  using (
    reporter_id = auth.uid()
    or claimed_by = auth.uid()
    or public.is_tenant_staff(tenant_id)
  );

create policy report_photos_select on public.report_photos
  for select to authenticated
  using (
    uploaded_by = auth.uid()
    or exists (
      select 1 from public.reports r
      where r.id = report_photos.report_id and public.is_tenant_staff(r.tenant_id)
    )
  );

create policy report_events_select on public.report_events
  for select to authenticated
  using (
    exists (
      select 1 from public.reports r
      where r.id = report_events.report_id
        and (r.reporter_id = auth.uid() or public.is_tenant_staff(r.tenant_id))
    )
  );

create policy report_confirmations_select on public.report_confirmations
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.reports r
      where r.id = report_confirmations.report_id and public.is_tenant_staff(r.tenant_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Photo storage bucket + policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 5242880, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

-- Uploads go into the uploader's own folder: <uid>/<uuid>.webp
create policy report_photos_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.is_blocked()
  );

create policy report_photos_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'report-photos' and public.can_read_photo(name));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.reports, public.report_photos, public.report_events, public.report_confirmations
  from anon, authenticated;
grant select on public.reports, public.report_photos, public.report_events, public.report_confirmations
  to authenticated;
grant select on public.reports_public, public.report_photos_public, public.report_events_public
  to anon, authenticated;

-- Internal helpers: not part of the API.
revoke execute on function
  public.log_report_event(uuid, public.report_event_type, public.report_status, public.report_status, jsonb),
  public.require_active_user(),
  public.attach_photo(public.reports, text, public.photo_kind, extensions.geography, timestamptz, real),
  public.publish_report(uuid, text),
  public.make_point(double precision, double precision)
  from public, anon, authenticated;

-- API: RPCs that need a user (anonymous sign-in counts) vs. public read RPCs.
revoke execute on function
  public.submit_report(uuid, double precision, double precision, public.report_category, public.report_size, public.hazard_type, text, real),
  public.add_report_photo(uuid, text, timestamptz),
  public.confirm_report(uuid),
  public.claim_report(uuid),
  public.unclaim_report(uuid),
  public.submit_cleanup(uuid, text, double precision, double precision, timestamptz, real),
  public.moderate_photo(uuid, boolean),
  public.set_report_status(uuid, public.report_status, text),
  public.mark_duplicate(uuid, uuid)
  from public, anon;
grant execute on function
  public.submit_report(uuid, double precision, double precision, public.report_category, public.report_size, public.hazard_type, text, real),
  public.add_report_photo(uuid, text, timestamptz),
  public.confirm_report(uuid),
  public.claim_report(uuid),
  public.unclaim_report(uuid),
  public.submit_cleanup(uuid, text, double precision, double precision, timestamptz, real),
  public.moderate_photo(uuid, boolean),
  public.set_report_status(uuid, public.report_status, text),
  public.mark_duplicate(uuid, uuid)
  to authenticated;
grant execute on function
  public.find_nearby_open_reports(double precision, double precision, double precision),
  public.reports_in_bbox(double precision, double precision, double precision, double precision, public.report_status[], integer)
  to anon, authenticated;
