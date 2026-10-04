-- Spatial index for the map query.
--
-- reports_in_bbox used to filter on the view's computed lng/lat columns, which no index covers:
-- every map pan was a sequential scan over all reports. It now filters the base table with the
-- bounding-box operator on an expression index.
--
-- The index is on location::geometry, not on the geography column: a map viewport is a
-- rectangle in lng/lat, and planar `&&` on geometry matches exactly that. Geography `&&`
-- compares boxes of great-circle edges, which bend away from latitude lines and would miss or
-- add reports near the edges of large viewports.

create index reports_location_geom_gix
  on public.reports using gist ((location::extensions.geometry));

drop function public.reports_in_bbox(
  double precision, double precision, double precision, double precision,
  public.report_status[], integer
);

create function public.reports_in_bbox(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_statuses public.report_status[] default null,
  p_limit integer default 2000,
  p_categories public.report_category[] default null
)
returns setof public.reports_public
language sql
stable
-- Definer: reads the base table for the index, but returns only reports_public rows/columns.
security definer
set search_path = ''
as $$
  select v.*
  from public.reports r
  join public.reports_public v on v.id = r.id
  where (r.location::extensions.geometry) operator(extensions.&&)
        extensions.st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)
    and (p_statuses is null or v.status = any (p_statuses))
    and (p_categories is null or v.category = any (p_categories))
  order by v.created_at desc
  limit least(greatest(coalesce(p_limit, 2000), 1), 5000);
$$;

revoke execute on function public.reports_in_bbox(
  double precision, double precision, double precision, double precision,
  public.report_status[], integer, public.report_category[]
) from public;
grant execute on function public.reports_in_bbox(
  double precision, double precision, double precision, double precision,
  public.report_status[], integer, public.report_category[]
) to anon, authenticated;
