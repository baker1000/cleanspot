import type { FeatureCollection, Point } from 'geojson';
import type { Bbox } from '@/features/geocoding';

/** Statuses shown on the public map (rejected/duplicate never reach the client). */
export const MAP_STATUSES = ['reported', 'confirmed', 'in_progress', 'cleared'] as const;
export type ReportStatus = (typeof MAP_STATUSES)[number];

export const CATEGORIES = [
  'plastic',
  'construction',
  'electronics',
  'mixed',
  'bulky',
  'hazardous',
  'other',
] as const;
export type ReportCategory = (typeof CATEGORIES)[number];

export type ReportSize = 'bag' | 'pile' | 'container' | 'truck';

export interface MapReport {
  id: string;
  lng: number;
  lat: number;
  status: ReportStatus;
  category: ReportCategory;
  isHazardous: boolean;
  size: ReportSize;
  confirmationCount: number;
  isClaimed: boolean;
  reportedByMe: boolean;
  createdAt: string;
}

export interface MapFilters {
  statuses: ReportStatus[];
  categories: ReportCategory[];
}

export const DEFAULT_FILTERS: MapFilters = {
  statuses: ['reported', 'confirmed', 'in_progress'],
  categories: [...CATEGORIES],
};

/**
 * Okabe-Ito palette (distinguishable with the common colour-vision deficiencies). Colour is never
 * the only cue: the legend, the list view and the preview sheet name the status in text.
 */
export const STATUS_COLORS: Record<ReportStatus, string> = {
  reported: '#D55E00',
  confirmed: '#E69F00',
  in_progress: '#0072B2',
  cleared: '#009E73',
};

/** Same limit as the RPC default; when reached, the UI asks the user to zoom in. */
export const MAX_MAP_REPORTS = 2000;

export interface ReportsApi {
  inBbox(bbox: Bbox, filters: MapFilters, signal?: AbortSignal): Promise<MapReport[]>;
}

/** Clamps a viewport to valid coordinates (zoomed-out maps can report lng beyond ±180). */
export function normalizeBbox([minLng, minLat, maxLng, maxLat]: Bbox): Bbox {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (maxLng - minLng >= 360) return [-180, clamp(minLat, -90, 90), 180, clamp(maxLat, -90, 90)];
  return [
    clamp(minLng, -180, 180),
    clamp(minLat, -90, 90),
    clamp(maxLng, -180, 180),
    clamp(maxLat, -90, 90),
  ];
}

interface ReportRow {
  id: string;
  lng: number;
  lat: number;
  status: string;
  category: ReportCategory;
  is_hazardous: boolean;
  size: ReportSize;
  confirmation_count: number;
  is_claimed: boolean;
  reported_by_me: boolean;
  created_at: string;
}

export function rowToMapReport(row: ReportRow): MapReport {
  return {
    id: row.id,
    lng: row.lng,
    lat: row.lat,
    status: row.status as ReportStatus,
    category: row.category,
    isHazardous: row.is_hazardous,
    size: row.size,
    confirmationCount: row.confirmation_count,
    isClaimed: row.is_claimed,
    reportedByMe: row.reported_by_me,
    createdAt: row.created_at,
  };
}

/** Minimal slice of SupabaseClient used here, so tests can pass a fake. */
export interface RpcClient {
  rpc(
    fn: 'reports_in_bbox',
    args: Record<string, unknown>,
  ): {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
  } & PromiseLike<{ data: unknown; error: unknown }>;
}

export function createSupabaseReportsApi(getClient: () => Promise<RpcClient>): ReportsApi {
  return {
    async inBbox(bbox, filters, signal) {
      if (filters.statuses.length === 0 || filters.categories.length === 0) return [];
      const [minLng, minLat, maxLng, maxLat] = normalizeBbox(bbox);
      const client = await getClient();
      // "All selected" is sent as null, so the query skips that filter.
      const call = client.rpc('reports_in_bbox', {
        p_min_lng: minLng,
        p_min_lat: minLat,
        p_max_lng: maxLng,
        p_max_lat: maxLat,
        p_statuses: filters.statuses.length === MAP_STATUSES.length ? null : filters.statuses,
        p_categories: filters.categories.length === CATEGORIES.length ? null : filters.categories,
        p_limit: MAX_MAP_REPORTS,
      });
      const { data, error } = await (signal ? call.abortSignal(signal) : call);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (error) throw error;
      return (data as ReportRow[]).map(rowToMapReport);
    },
  };
}

/** GeoJSON for the clustered map source. */
export function toFeatureCollection(reports: MapReport[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: reports.map((r) => ({
      type: 'Feature',
      id: r.id,
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: { id: r.id, status: r.status, hazardous: r.isHazardous },
    })),
  };
}

/** Great-circle distance in metres (for sorting the list view). */
export function distanceMeters(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
