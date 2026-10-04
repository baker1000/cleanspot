// Backend calls of the report form. Every step of `submit` is idempotent, so a retry after a
// network error (and later the offline queue) can simply run it again with the same draft:
//   1. upload each photo to <uid>/<photo id>.<ext>   ("already exists" counts as done)
//   2. submit_report(client_id, …)                   (returns the existing id for a known client_id)
//   3. add_report_photo(report, path)                ("already attached" counts as done)
import type { ReportCategory, ReportSize } from '@/features/map/reports';

export const HAZARD_TYPES = [
  'batteries',
  'chemicals',
  'asbestos',
  'needles',
  'oil',
  'other',
] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];
export const SIZES: ReportSize[] = ['bag', 'pile', 'container', 'truck'];
export const MAX_PHOTOS = 3;
export const MAX_COMMENT = 500;
export const PHOTO_BUCKET = 'report-photos';

export interface DraftPhoto {
  /** UUID generated on the device; becomes the file name. */
  id: string;
  blob: Blob;
  ext: 'webp' | 'jpg';
}

export interface ReportDraft {
  /** Generated once per draft; makes submit_report idempotent. */
  clientId: string;
  lng: number;
  lat: number;
  accuracyM: number | null;
  category: ReportCategory;
  hazardType: HazardType | null;
  size: ReportSize;
  comment: string;
  photos: DraftPhoto[];
}

export interface TenantInfo {
  kind: 'municipality' | 'public';
  name: string;
  bulkyWasteUrl: string | null;
}

export interface NearbyReport {
  id: string;
  distanceM: number;
  category: ReportCategory;
  status: string;
}

export type SubmitErrorReason =
  'rate_limited' | 'blocked' | 'invalid' | 'photo' | 'network' | 'server';

export class SubmitError extends Error {
  constructor(
    public readonly reason: SubmitErrorReason,
    cause?: unknown,
  ) {
    super(`Report could not be submitted: ${reason}`, { cause });
    this.name = 'SubmitError';
  }
}

export interface ReportSubmitApi {
  /** Who receives a report here; null if unknown (e.g. offline). */
  tenantAt(lng: number, lat: number, signal?: AbortSignal): Promise<TenantInfo | null>;
  /** Open reports close by, for the duplicate warning. */
  nearby(lng: number, lat: number, signal?: AbortSignal): Promise<NearbyReport[]>;
  /** Uploads photos and creates the report; returns the report id. */
  submit(draft: ReportDraft, userId: string): Promise<string>;
}

export const photoPath = (userId: string, photo: DraftPhoto) =>
  `${userId}/${photo.id}.${photo.ext}`;

interface PgError {
  code?: string;
  message?: string;
  status?: number;
  statusCode?: string | number;
  name?: string;
}

/** Maps PostgREST / Storage / fetch errors to what the form can tell the user. */
export function classifyError(error: unknown): SubmitErrorReason {
  const e = (error ?? {}) as PgError;
  const status = Number(e.status ?? e.statusCode);
  if (e.code === 'PT429' || status === 429) return 'rate_limited';
  if (e.code === '42501' || status === 403) return 'blocked';
  if (e.code === 'CS007' || e.code === 'CS009' || e.code === '22P02') return 'invalid';
  if (e.code === 'CS005' || e.code === 'CS006' || status === 413) return 'photo';
  if (error instanceof TypeError || e.name === 'StorageUnknownError' || e.name === 'FetchError') {
    return 'network';
  }
  if (/fetch|network/i.test(e.message ?? '')) return 'network';
  return 'server';
}

type Result = { data: unknown; error: unknown };

/** Minimal slice of SupabaseClient used here, so tests can pass a fake. */
export interface SubmitClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<Result> & { abortSignal?(signal: AbortSignal): PromiseLike<Result> };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Blob,
        opts: { contentType: string; upsert: boolean },
      ): Promise<Result>;
    };
  };
}

const isAlreadyUploaded = (error: unknown) => {
  const e = error as PgError;
  return (
    Number(e.status ?? e.statusCode) === 409 || /already exists|duplicate/i.test(e.message ?? '')
  );
};
const isAlreadyAttached = (error: unknown) => {
  const e = error as PgError;
  return e.code === 'CS005' && /already attached/i.test(e.message ?? '');
};

async function call(
  client: SubmitClient,
  fn: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const builder = client.rpc(fn, args);
  return signal && builder.abortSignal ? builder.abortSignal(signal) : builder;
}

export function createSupabaseSubmitApi(getClient: () => Promise<SubmitClient>): ReportSubmitApi {
  return {
    async tenantAt(lng, lat, signal) {
      try {
        const { data, error } = await call(
          await getClient(),
          'tenant_at_point',
          { p_lng: lng, p_lat: lat },
          signal,
        );
        const row = (
          data as
            { kind: TenantInfo['kind']; name: string; bulky_waste_url: string | null }[] | null
        )?.[0];
        if (error || !row) return null;
        return { kind: row.kind, name: row.name, bulkyWasteUrl: row.bulky_waste_url };
      } catch {
        return null;
      }
    },

    async nearby(lng, lat, signal) {
      try {
        const { data, error } = await call(
          await getClient(),
          'find_nearby_open_reports',
          { p_lng: lng, p_lat: lat },
          signal,
        );
        if (error || !Array.isArray(data)) return [];
        return (
          data as { id: string; distance_m: number; category: ReportCategory; status: string }[]
        ).map((r) => ({
          id: r.id,
          distanceM: r.distance_m,
          category: r.category,
          status: r.status,
        }));
      } catch {
        return [];
      }
    },

    async submit(draft, userId) {
      let client: SubmitClient;
      try {
        client = await getClient();
      } catch (error) {
        throw new SubmitError('network', error);
      }
      const fail = (error: unknown): never => {
        throw new SubmitError(classifyError(error), error);
      };

      try {
        for (const photo of draft.photos) {
          const { error } = await client.storage
            .from(PHOTO_BUCKET)
            .upload(photoPath(userId, photo), photo.blob, {
              contentType: photo.ext === 'webp' ? 'image/webp' : 'image/jpeg',
              upsert: false,
            });
          if (error && !isAlreadyUploaded(error)) fail(error);
        }

        const { data: reportId, error } = await client.rpc('submit_report', {
          p_client_id: draft.clientId,
          p_lng: draft.lng,
          p_lat: draft.lat,
          p_category: draft.category,
          p_size: draft.size,
          p_hazard_type: draft.category === 'hazardous' ? draft.hazardType : null,
          p_comment: draft.comment.trim() || null,
          p_accuracy_m: draft.accuracyM,
        });
        if (error) fail(error);

        for (const photo of draft.photos) {
          const { error: attachError } = await client.rpc('add_report_photo', {
            p_report_id: reportId,
            p_path: photoPath(userId, photo),
          });
          if (attachError && !isAlreadyAttached(attachError)) fail(attachError);
        }
        return reportId as string;
      } catch (error) {
        if (error instanceof SubmitError) throw error;
        throw new SubmitError(classifyError(error), error);
      }
    },
  };
}
