-- CleanSpot · Migration 1: core tenancy, profiles, memberships, role helpers.
--
-- Conventions
--   * All tables live in `public` and have RLS enabled. No table is writable without a policy.
--   * Helper functions used inside policies are SECURITY DEFINER with an empty search_path,
--     so they cannot be hijacked and do not recurse into RLS.
--   * Geometry is geography(…, 4326) so distances are in metres.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.tenant_kind as enum ('public', 'municipality');

-- "citizen" is not stored: any signed-in user (incl. anonymous) without a membership.
-- super_admin is a flag on profiles, not a tenant role.
create type public.member_role as enum (
  'volunteer',
  'organizer',
  'municipality_staff',
  'municipality_admin'
);

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Default tenant settings. Stored settings are merged on top, so new keys get sane defaults.
create function public.default_tenant_settings()
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
    'bulky_waste_url', null,             -- link to local bulky-waste booking
    'kg_per_size', jsonb_build_object('bag', 5, 'pile', 40, 'container', 300, 'truck', 1500),
    'kg_per_bag', 6
  );
$$;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  name text not null check (length(name) between 2 and 120),
  kind public.tenant_kind not null,
  area extensions.geography(MultiPolygon, 4326),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint municipality_requires_area check (kind = 'public' or area is not null),
  constraint public_has_no_area check (kind = 'municipality' or area is null)
);

comment on table public.tenants is
  'A municipality (with an area polygon) or the single public/community tenant.';

-- Exactly one public tenant per install.
create unique index tenants_single_public on public.tenants (kind) where kind = 'public';
create index tenants_area_gix on public.tenants using gist (area);

create trigger tenants_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

-- Effective settings = defaults overlaid with stored settings.
create function public.tenant_settings(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.default_tenant_settings() || coalesce(t.settings, '{}'::jsonb)
  from public.tenants t
  where t.id = p_tenant_id;
$$;

-- Routing: smallest municipality whose area contains the point, else the public tenant.
create function public.tenant_for_point(p_point extensions.geography)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select t.id
      from public.tenants t
      where t.kind = 'municipality'
        and extensions.st_covers(t.area, p_point)
      order by extensions.st_area(t.area) asc
      limit 1
    ),
    (select t.id from public.tenants t where t.kind = 'public' limit 1)
  );
$$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users; email stays in auth.users only)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or length(display_name) between 1 and 60),
  locale text not null default 'de' check (locale in ('de', 'en', 'ar', 'fr', 'tr', 'uk')),
  easy_mode boolean not null default false,
  is_super_admin boolean not null default false,
  blocked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.is_super_admin is
  'Install-wide administrator. Only changeable by the service role or another super admin.';

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Every new auth user (incl. anonymous sign-ins) gets a profile.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Public display names without exposing any other profile column.
-- Runs with the view owner's rights on purpose (security_invoker = false).
create view public.public_profiles
with (security_invoker = false)
as
  select p.id, p.display_name
  from public.profiles p;

-- ---------------------------------------------------------------------------
-- Memberships (role per user per tenant)
-- ---------------------------------------------------------------------------

create table public.memberships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  primary key (user_id, tenant_id)
);

create index memberships_tenant_idx on public.memberships (tenant_id, role);

-- ---------------------------------------------------------------------------
-- Role helpers (used by RLS policies everywhere)
-- ---------------------------------------------------------------------------

create function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_super_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create function public.is_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.blocked_until > now() from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create function public.tenant_role(p_tenant_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  where m.user_id = auth.uid() and m.tenant_id = p_tenant_id;
$$;

-- True if the current user holds one of the given roles in the tenant (super admins always pass).
create function public.has_tenant_role(p_tenant_id uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin()
      or coalesce(public.tenant_role(p_tenant_id) = any (p_roles), false);
$$;

create function public.is_tenant_staff(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_tenant_role(
    p_tenant_id,
    array['municipality_staff', 'municipality_admin']::public.member_role[]
  );
$$;

create function public.is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_tenant_role(p_tenant_id, array['municipality_admin']::public.member_role[]);
$$;

-- ---------------------------------------------------------------------------
-- Guards for columns that RLS cannot protect on its own
-- ---------------------------------------------------------------------------

-- Tenant admins may edit name/settings/contact, but slug, kind and area are super-admin only.
create function public.guard_tenant_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.slug, new.kind, new.area) is distinct from (old.slug, old.kind, old.area)
     and not public.is_super_admin()
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Only super admins can change slug, kind or area of a tenant'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tenants_guard_update
before update on public.tenants
for each row execute function public.guard_tenant_update();

-- Users may edit their own name/locale/easy_mode; privileged columns need a super admin.
create function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.is_super_admin, new.blocked_until) is distinct from (old.is_super_admin, old.blocked_until)
     and not public.is_super_admin()
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Not allowed to change is_super_admin or blocked_until'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_update
before update on public.profiles
for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;

-- Tenants: public metadata, readable by everyone (needed for routing UI and the landing page).
create policy tenants_select on public.tenants
  for select to anon, authenticated
  using (true);

create policy tenants_insert on public.tenants
  for insert to authenticated
  with check (public.is_super_admin());

create policy tenants_update on public.tenants
  for update to authenticated
  using (public.is_tenant_admin(id))
  with check (public.is_tenant_admin(id));

create policy tenants_delete on public.tenants
  for delete to authenticated
  using (public.is_super_admin());

-- Profiles: own row; staff/admins of a tenant can see profiles of that tenant's members.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_super_admin()
    or exists (
      select 1 from public.memberships m
      where m.user_id = profiles.id and public.is_tenant_staff(m.tenant_id)
    )
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

-- No insert policy: profiles are created by the auth trigger only.
-- No delete policy: deleting the auth user cascades (account deletion runs server-side).

-- Memberships
create policy memberships_select on public.memberships
  for select to authenticated
  using (user_id = auth.uid() or public.is_tenant_staff(tenant_id));

-- Admins manage memberships of their tenant. Anyone (not blocked, not anonymous)
-- may join the PUBLIC tenant as a volunteer themselves.
create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    or (
      user_id = auth.uid()
      and role = 'volunteer'
      and not public.is_blocked()
      and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
      and exists (select 1 from public.tenants t where t.id = tenant_id and t.kind = 'public')
    )
  );

create policy memberships_update on public.memberships
  for update to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- Users can leave a tenant; admins can remove members.
create policy memberships_delete on public.memberships
  for delete to authenticated
  using (user_id = auth.uid() or public.is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- Grants (Supabase grants broad table privileges by default; we narrow them)
-- ---------------------------------------------------------------------------

revoke all on public.tenants, public.profiles, public.memberships from anon, authenticated;

grant select on public.tenants to anon, authenticated;
grant insert, update, delete on public.tenants to authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, locale, easy_mode, is_super_admin, blocked_until)
  on public.profiles to authenticated;

grant select, insert, update, delete on public.memberships to authenticated;

grant select on public.public_profiles to anon, authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
