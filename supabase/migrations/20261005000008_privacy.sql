-- CleanSpot · Migration 8: DSGVO self-service (Art. 15, 17, 20) and leaving the volunteer role.
--
--   * export_my_data(): everything stored about the current user, as one JSON document.
--   * delete_my_photos(): removes the database rows of every photo the user uploaded and returns
--     their storage paths, so the app can delete the files right away (policy below). Files the
--     app could not delete are orphans and go with the next maintenance run (migration 3).
--   * delete_my_account(): deletes the user's photos and comments, takes their name off the
--     reports they made, claimed or cleared (the reports stay on the map: the waste is still
--     there), releases open claims and finally deletes the auth user (cascades to profile,
--     memberships, confirmations).
--   * leave_volunteer_role(): drops the user's volunteer memberships and gives back their open
--     claims.
--
-- None of these require an active (non-blocked) user: data rights apply to blocked users too.

-- Gives back the user's open claims (in_progress, claimed_by = user), optionally keeping those in
-- tenants where the user is staff. Logged as 'unclaimed' by the current user. Returns how many.
create function public.release_claims_of(p_user_id uuid, p_reason text, p_keep_staff boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with released as (
    update public.reports r
    set status = case when r.confirmation_count > 0 then 'confirmed' else 'reported' end::public.report_status,
        claimed_by = null,
        claimed_at = null
    where r.claimed_by = p_user_id and r.status = 'in_progress'
      and not (p_keep_staff and public.is_tenant_staff(r.tenant_id))
    returning r.id, r.status
  ),
  logged as (
    insert into public.report_events (report_id, actor_id, type, from_status, to_status, data)
    select x.id, auth.uid(), 'unclaimed', 'in_progress', x.status, jsonb_build_object('reason', p_reason)
    from released x
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end;
$$;

create function public.export_my_data()
returns jsonb
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

  return jsonb_build_object(
    'format', 'cleanspot-export-v1',
    'exported_at', now(),
    'account', (
      select jsonb_build_object(
        'id', u.id, 'email', u.email, 'is_anonymous', u.is_anonymous, 'created_at', u.created_at
      )
      from auth.users u where u.id = v_uid
    ),
    'profile', (
      select jsonb_build_object(
        'display_name', p.display_name, 'locale', p.locale, 'easy_mode', p.easy_mode,
        'is_super_admin', p.is_super_admin, 'blocked_until', p.blocked_until,
        'created_at', p.created_at, 'updated_at', p.updated_at
      )
      from public.profiles p where p.id = v_uid
    ),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tenant', t.name, 'role', m.role, 'since', m.created_at
      ) order by m.created_at)
      from public.memberships m join public.tenants t on t.id = m.tenant_id
      where m.user_id = v_uid
    ), '[]'::jsonb),
    -- Reports the user made, claimed, was assigned or cleared.
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'my_role', array_remove(array[
          case when r.reporter_id = v_uid then 'reporter' end,
          case when r.claimed_by = v_uid then 'claimed' end,
          case when r.assigned_to = v_uid then 'assigned' end,
          case when r.cleared_by = v_uid then 'cleared' end
        ], null),
        'created_at', r.created_at,
        'lng', extensions.st_x(r.location::extensions.geometry),
        'lat', extensions.st_y(r.location::extensions.geometry),
        'accuracy_m', r.accuracy_m,
        'category', r.category,
        'hazard_type', r.hazard_type,
        'size', r.size,
        'comment', case when r.reporter_id = v_uid then r.comment end,
        'status', r.status,
        'estimated_kg', r.estimated_kg,
        'claimed_at', case when r.claimed_by = v_uid then r.claimed_at end,
        'cleared_at', case when r.cleared_by = v_uid then r.cleared_at end
      ) order by r.created_at)
      from public.reports r
      where v_uid in (r.reporter_id, r.claimed_by, r.assigned_to, r.cleared_by)
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'report_id', p.report_id,
        'kind', p.kind,
        'storage_path', p.storage_path,
        'taken_at', p.taken_at,
        'lng', extensions.st_x(p.location::extensions.geometry),
        'lat', extensions.st_y(p.location::extensions.geometry),
        'distance_to_report_m', p.distance_to_report_m,
        'moderation', p.moderation,
        'created_at', p.created_at
      ) order by p.created_at)
      from public.report_photos p where p.uploaded_by = v_uid
    ), '[]'::jsonb),
    'confirmations', coalesce((
      select jsonb_agg(jsonb_build_object('report_id', c.report_id, 'created_at', c.created_at)
        order by c.created_at)
      from public.report_confirmations c where c.user_id = v_uid
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'report_id', e.report_id, 'type', e.type, 'from_status', e.from_status,
        'to_status', e.to_status, 'data', e.data, 'created_at', e.created_at
      ) order by e.created_at)
      from public.report_events e where e.actor_id = v_uid
    ), '[]'::jsonb),
    'bag_pickups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'report_id', t.report_id,
        'my_role', array_remove(array[
          case when t.created_by = v_uid then 'placed' end,
          case when t.collected_by = v_uid then 'collected' end
        ], null),
        'lng', extensions.st_x(t.location::extensions.geometry),
        'lat', extensions.st_y(t.location::extensions.geometry),
        'bag_count', t.bag_count,
        'status', t.status,
        'created_at', t.created_at,
        'collected_at', t.collected_at
      ) order by t.created_at)
      from public.pickup_tasks t where v_uid in (t.created_by, t.collected_by)
    ), '[]'::jsonb)
  );
end;
$$;

create function public.delete_my_photos()
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign-in required' using errcode = 'CS009';
  end if;
  return query
    delete from public.report_photos p where p.uploaded_by = v_uid returning p.storage_path;
end;
$$;

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign-in required' using errcode = 'CS009';
  end if;

  -- Usually done by the app before (to delete the files); repeated here so nothing is left.
  delete from public.report_photos p where p.uploaded_by = v_uid;
  -- A free-text comment may say who wrote it; the report itself is not personal.
  update public.reports r set comment = null where r.reporter_id = v_uid and r.comment is not null;
  perform public.release_claims_of(v_uid, 'account_deleted', false);
  -- Cascades: profile, memberships, confirmations; reporter/claimer/clearer/actor become null.
  delete from auth.users u where u.id = v_uid;
end;
$$;

create function public.leave_volunteer_role()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign-in required' using errcode = 'CS009';
  end if;
  delete from public.memberships m where m.user_id = v_uid and m.role = 'volunteer';
  -- Claims in a tenant where the user is staff stay; everything else is given back.
  return public.release_claims_of(v_uid, 'left_volunteer_role', true);
end;
$$;

-- The app deletes the user's own photo files after delete_my_photos(): own folder only, and only
-- files no report references any more (so attached photos cannot be removed behind the
-- database's back).
create policy report_photos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (select 1 from public.report_photos p where p.storage_path = objects.name)
  );

revoke execute on function public.release_claims_of(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function
  public.export_my_data(),
  public.delete_my_photos(),
  public.delete_my_account(),
  public.leave_volunteer_role()
  from public, anon;
grant execute on function
  public.export_my_data(),
  public.delete_my_photos(),
  public.delete_my_account(),
  public.leave_volunteer_role()
  to authenticated;
