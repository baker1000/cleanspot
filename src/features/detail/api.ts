// Backend calls of the report detail page. Reads go through the public views (anyone may look at
// a report); the viewer's own photos under review come from the RLS-filtered base table. Every
// action is an RPC that checks permissions and the status machine on the server; the page only
// mirrors those rules to decide which buttons to show.
import type { ReportCategory, ReportSize, ReportStatus } from '@/features/map/reports';
import {
  classifyError,
  PHOTO_BUCKET,
  photoPath,
  type DraftPhoto,
  type HazardType,
} from '@/features/report/api';

/** Signed photo URLs are requested per page view; one hour is plenty. */
export const PHOTO_URL_TTL_S = 3600;
/** Fallback when the tenant setting cannot be read; the server checks the real value. */
export const DEFAULT_CLEANUP_RADIUS_M = 50;

export type PhotoKind = 'before' | 'after' | 'bags';

export interface DetailPhoto {
  id: string;
  kind: PhotoKind;
  /** Signed URL; null if the file could not be signed (e.g. removed). */
  url: string | null;
  /** Visible only to its uploader (and staff) until it is reviewed. */
  pending: boolean;
  takenAt: string | null;
}

export type EventType =
  | 'created'
  | 'confirmed'
  | 'claimed'
  | 'unclaimed'
  | 'cleared'
  | 'status_changed'
  | 'marked_duplicate'
  | 'photo_added'
  | 'photo_approved'
  | 'photo_rejected'
  | 'published';

export interface DetailEvent {
  id: string;
  type: EventType;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
}

/** What the current user may do here, as far as the client can tell. */
export interface Viewer {
  confirmed: boolean;
  /** staff: tenant staff of this report; volunteer: may claim (member here or of the public
   *  tenant); none: would have to join as a volunteer first. */
  role: 'staff' | 'volunteer' | 'none';
  /** Where "join as volunteer" adds the membership; null if there is no public tenant. */
  publicTenantId: string | null;
}

export interface ReportDetail {
  id: string;
  tenantId: string;
  tenantName: string | null;
  lng: number;
  lat: number;
  status: ReportStatus;
  category: ReportCategory;
  hazardType: HazardType | null;
  isHazardous: boolean;
  size: ReportSize;
  /** Only once the report is published. */
  comment: string | null;
  isPublished: boolean;
  confirmationCount: number;
  estimatedKg: number | null;
  isClaimed: boolean;
  claimedByMe: boolean;
  reportedByMe: boolean;
  createdAt: string;
  clearedAt: string | null;
  cleanupRadiusM: number;
  photos: DetailPhoto[];
  events: DetailEvent[];
  /** null when nobody is signed in (not even anonymously). */
  viewer: Viewer | null;
}

export type ActionErrorReason =
  | 'too_far'
  | 'claimed'
  | 'hazardous'
  | 'status'
  | 'account'
  | 'not_allowed'
  | 'invalid'
  | 'photo'
  | 'rate_limited'
  | 'network'
  | 'server';

export class ActionError extends Error {
  constructor(
    public readonly reason: ActionErrorReason,
    /** For too_far: how far away the photo was taken, and the allowed radius. */
    public readonly distance?: { meters: number; maxMeters: number },
    cause?: unknown,
  ) {
    super(`Action failed: ${reason}`, { cause });
    this.name = 'ActionError';
  }
}

export interface CleanupInput {
  reportId: string;
  photo: DraftPhoto;
  lng: number;
  lat: number;
  accuracyM: number | null;
  /** When the photo was taken (ISO). */
  takenAt: string;
}

export interface DetailApi {
  /** null if the report does not exist or is not public (rejected, duplicate). */
  load(id: string, viewerId: string | null, signal?: AbortSignal): Promise<ReportDetail | null>;
  /** Returns the new number of confirmations. */
  confirm(reportId: string): Promise<number>;
  claim(reportId: string): Promise<void>;
  unclaim(reportId: string): Promise<void>;
  joinAsVolunteer(userId: string, publicTenantId: string): Promise<void>;
  /** Uploads the after-photo and marks the report cleared; returns the distance in metres. */
  submitCleanup(input: CleanupInput, userId: string): Promise<number>;
}

interface PgError {
  code?: string;
  message?: string;
}

/** Maps RPC error codes (see migration 2) to what the page can tell the user. */
export function classifyActionError(error: unknown): ActionError {
  if (error instanceof ActionError) return error;
  const e = (error ?? {}) as PgError;
  const byCode: Record<string, ActionErrorReason> = {
    CS001: 'status',
    CS002: 'too_far',
    CS003: 'claimed',
    CS004: 'hazardous',
    CS005: 'photo',
    CS006: 'photo',
    CS007: 'invalid',
    CS008: 'account',
    CS009: 'account',
    '42501': 'not_allowed',
  };
  const reason = (e.code && byCode[e.code]) || fromSubmitReason(classifyError(error));
  if (reason === 'too_far') {
    // "After-photo was taken 73 m from the report (max 50 m)"
    const m = /(\d+(?:\.\d+)?) m .*max (\d+(?:\.\d+)?) m/.exec(e.message ?? '');
    const distance = m ? { meters: Number(m[1]), maxMeters: Number(m[2]) } : undefined;
    return new ActionError(reason, distance, error);
  }
  return new ActionError(reason, undefined, error);
}

function fromSubmitReason(reason: ReturnType<typeof classifyError>): ActionErrorReason {
  return reason === 'blocked' ? 'not_allowed' : reason;
}

type Result<T = unknown> = { data: T; error: unknown };

interface Query extends PromiseLike<Result> {
  eq(column: string, value: unknown): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  maybeSingle(): PromiseLike<Result>;
  abortSignal(signal: AbortSignal): Query;
}

/** Minimal slice of SupabaseClient used here, so tests can pass a fake. */
export interface DetailClient {
  from(table: string): {
    select(columns: string): Query;
    insert(row: Record<string, unknown>): PromiseLike<Result>;
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<Result>;
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Blob,
        opts: { contentType: string; upsert: boolean },
      ): Promise<Result>;
      createSignedUrls(
        paths: string[],
        expiresIn: number,
      ): Promise<Result<{ path: string | null; signedUrl: string | null }[] | null>>;
    };
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REPORT_COLUMNS =
  'id, tenant_id, lng, lat, category, hazard_type, is_hazardous, size, status, comment, ' +
  'is_published, confirmation_count, estimated_kg, is_claimed, claimed_by_me, reported_by_me, ' +
  'created_at, cleared_at';

interface ReportRow {
  id: string;
  tenant_id: string;
  lng: number;
  lat: number;
  category: ReportCategory;
  hazard_type: HazardType | null;
  is_hazardous: boolean;
  size: ReportSize;
  status: ReportStatus;
  comment: string | null;
  is_published: boolean;
  confirmation_count: number;
  estimated_kg: number | string | null;
  is_claimed: boolean;
  claimed_by_me: boolean;
  reported_by_me: boolean;
  created_at: string;
  cleared_at: string | null;
}

interface PhotoRow {
  id: string;
  kind: PhotoKind;
  storage_path: string;
  taken_at: string | null;
  moderation?: 'pending' | 'approved' | 'rejected';
}

interface EventRow {
  id: string;
  type: EventType;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
}

const STAFF_ROLES = new Set(['municipality_staff', 'municipality_admin']);

export function createSupabaseDetailApi(getClient: () => Promise<DetailClient>): DetailApi {
  const client = async () => {
    try {
      return await getClient();
    } catch (error) {
      throw new ActionError('network', undefined, error);
    }
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await (await client()).rpc(fn, args);
    if (error) throw classifyActionError(error);
    return data;
  };
  const query = async <T>(q: PromiseLike<Result>): Promise<T> => {
    const { data, error } = await q;
    if (error) throw error;
    return data as T;
  };

  return {
    async load(id, viewerId, signal) {
      if (!UUID.test(id)) return null;
      const c = await getClient();
      const sel = (table: string, columns: string) => {
        const q = c.from(table).select(columns);
        return signal ? q.abortSignal(signal) : q;
      };

      const [report, publicPhotos, events] = await Promise.all([
        query<ReportRow | null>(sel('reports_public', REPORT_COLUMNS).eq('id', id).maybeSingle()),
        query<PhotoRow[]>(
          sel('report_photos_public', 'id, kind, storage_path, taken_at')
            .eq('report_id', id)
            .order('created_at'),
        ),
        query<EventRow[]>(
          sel('report_events_public', 'id, type, from_status, to_status, created_at')
            .eq('report_id', id)
            .order('created_at'),
        ),
      ]);
      if (!report) return null;

      const [tenant, ownPhotos, viewer] = await Promise.all([
        query<{ name: string; settings: Record<string, unknown> | null } | null>(
          sel('tenants', 'name, settings').eq('id', report.tenant_id).maybeSingle(),
        ).catch(() => null),
        // RLS: own uploads (and everything for staff), including those under review.
        viewerId
          ? query<PhotoRow[]>(
              sel('report_photos', 'id, kind, storage_path, taken_at, moderation')
                .eq('report_id', id)
                .order('created_at'),
            ).catch(() => [])
          : Promise.resolve([]),
        viewerId ? loadViewer(sel, id, viewerId, report.tenant_id) : Promise.resolve(null),
      ]);

      const seen = new Set(publicPhotos.map((p) => p.id));
      const photoRows = [
        ...publicPhotos.map((p) => ({ ...p, pending: false })),
        ...ownPhotos
          .filter((p) => !seen.has(p.id) && p.moderation === 'pending')
          .map((p) => ({ ...p, pending: true })),
      ];
      const urls = new Map<string, string>();
      if (photoRows.length) {
        const { data } = await c.storage.from(PHOTO_BUCKET).createSignedUrls(
          photoRows.map((p) => p.storage_path),
          PHOTO_URL_TTL_S,
        );
        for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
      }

      const radius = Number(tenant?.settings?.cleanup_radius_m);
      return {
        id: report.id,
        tenantId: report.tenant_id,
        tenantName: tenant?.name ?? null,
        lng: report.lng,
        lat: report.lat,
        status: report.status,
        category: report.category,
        hazardType: report.hazard_type,
        isHazardous: report.is_hazardous,
        size: report.size,
        comment: report.comment,
        isPublished: report.is_published,
        confirmationCount: report.confirmation_count,
        estimatedKg: report.estimated_kg === null ? null : Number(report.estimated_kg),
        isClaimed: report.is_claimed,
        claimedByMe: report.claimed_by_me,
        reportedByMe: report.reported_by_me,
        createdAt: report.created_at,
        clearedAt: report.cleared_at,
        cleanupRadiusM: Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_CLEANUP_RADIUS_M,
        photos: photoRows.map((p) => ({
          id: p.id,
          kind: p.kind,
          url: urls.get(p.storage_path) ?? null,
          pending: p.pending,
          takenAt: p.taken_at,
        })),
        events: events.map((e) => ({
          id: e.id,
          type: e.type,
          fromStatus: e.from_status,
          toStatus: e.to_status,
          createdAt: e.created_at,
        })),
        viewer,
      };
    },

    async confirm(reportId) {
      return Number(await rpc('confirm_report', { p_report_id: reportId }));
    },
    async claim(reportId) {
      await rpc('claim_report', { p_report_id: reportId });
    },
    async unclaim(reportId) {
      await rpc('unclaim_report', { p_report_id: reportId });
    },

    async joinAsVolunteer(userId, publicTenantId) {
      const { error } = await (
        await client()
      )
        .from('memberships')
        .insert({ user_id: userId, tenant_id: publicTenantId, role: 'volunteer' });
      // Already a member (e.g. joined in another tab) counts as done.
      if (error && (error as PgError).code !== '23505') throw classifyActionError(error);
    },

    async submitCleanup(input, userId) {
      const c = await client();
      const path = photoPath(userId, input.photo);
      const { error: uploadError } = await c.storage
        .from(PHOTO_BUCKET)
        .upload(path, input.photo.blob, {
          contentType: input.photo.ext === 'webp' ? 'image/webp' : 'image/jpeg',
          upsert: false,
        });
      const e = (uploadError ?? null) as (PgError & { statusCode?: string | number }) | null;
      const alreadyThere =
        e && (Number(e.statusCode) === 409 || /already exists|duplicate/i.test(e.message ?? ''));
      if (uploadError && !alreadyThere) throw classifyActionError(uploadError);

      const data = (await rpc('submit_cleanup', {
        p_report_id: input.reportId,
        p_photo_path: path,
        p_lng: input.lng,
        p_lat: input.lat,
        p_taken_at: input.takenAt,
        p_accuracy_m: input.accuracyM,
      })) as { distance_m?: number } | null;
      return Number(data?.distance_m ?? 0);
    },
  };
}

async function loadViewer(
  sel: (table: string, columns: string) => Query,
  reportId: string,
  viewerId: string,
  tenantId: string,
): Promise<Viewer> {
  const read = async <T>(q: PromiseLike<Result>, fallback: T): Promise<T> => {
    const { data, error } = await q;
    return error ? fallback : ((data as T) ?? fallback);
  };
  const [confirmation, memberships, publicTenant] = await Promise.all([
    read<{ report_id: string } | null>(
      sel('report_confirmations', 'report_id')
        .eq('report_id', reportId)
        .eq('user_id', viewerId)
        .maybeSingle(),
      null,
    ),
    read<{ tenant_id: string; role: string }[]>(
      sel('memberships', 'tenant_id, role').eq('user_id', viewerId),
      [],
    ),
    read<{ id: string } | null>(sel('tenants', 'id').eq('kind', 'public').maybeSingle(), null),
  ]);
  const here = memberships.find((m) => m.tenant_id === tenantId);
  const role: Viewer['role'] =
    here && STAFF_ROLES.has(here.role)
      ? 'staff'
      : here || memberships.some((m) => m.tenant_id === publicTenant?.id)
        ? 'volunteer'
        : 'none';
  return { confirmed: confirmation !== null, role, publicTenantId: publicTenant?.id ?? null };
}
