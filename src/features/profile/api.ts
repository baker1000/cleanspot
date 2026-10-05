// DSGVO self-service: data export (Art. 15/20), account deletion (Art. 17), leaving the
// volunteer role. Server side: migration 8 (export_my_data, delete_my_photos, delete_my_account,
// leave_volunteer_role).
import { classifyActionError } from '@/features/detail/api';
import { PHOTO_BUCKET } from '@/features/report/api';
import { isNative, shareTextFile } from '@/lib/native';

/** Photo links in the export stay valid this long (the export says until when). */
export const EXPORT_PHOTO_URL_TTL_S = 7 * 24 * 3600;
const REMOVE_BATCH = 100;

export interface DataExport {
  fileName: string;
  json: string;
}

export interface ProfileApi {
  isVolunteer(userId: string): Promise<boolean>;
  /** Returns how many open claims were given back. */
  leaveVolunteerRole(): Promise<number>;
  exportData(): Promise<DataExport>;
  /** Deletes photos (rows and files), then the account. The caller signs out locally. */
  deleteAccount(): Promise<void>;
}

type Result<T = unknown> = { data: T; error: unknown };

interface Query extends PromiseLike<Result> {
  eq(column: string, value: unknown): Query;
}

/** Minimal slice of SupabaseClient used here, so tests can pass a fake. */
export interface ProfileClient {
  from(table: string): { select(columns: string): Query };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Result>;
  storage: {
    from(bucket: string): {
      createSignedUrls(
        paths: string[],
        expiresIn: number,
      ): Promise<Result<{ path: string | null; signedUrl: string | null }[] | null>>;
      remove(paths: string[]): Promise<Result>;
    };
  };
}

interface ExportPhoto {
  storage_path: string;
  [key: string]: unknown;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function createSupabaseProfileApi(
  getClient: () => Promise<ProfileClient>,
  now: () => Date = () => new Date(),
): ProfileApi {
  const rpc = async (fn: string) => {
    const { data, error } = await (await getClient()).rpc(fn, {});
    if (error) throw classifyActionError(error);
    return data;
  };

  return {
    async isVolunteer(userId) {
      const { data, error } = await (
        await getClient()
      )
        .from('memberships')
        .select('role')
        .eq('user_id', userId);
      if (error) throw classifyActionError(error);
      return ((data ?? []) as { role: string }[]).some((m) => m.role === 'volunteer');
    },

    async leaveVolunteerRole() {
      return Number((await rpc('leave_volunteer_role')) ?? 0);
    },

    async exportData() {
      const data = (await rpc('export_my_data')) as { photos?: ExportPhoto[] } & Record<
        string,
        unknown
      >;
      const photos = data.photos ?? [];
      // Links to the photo files, so the export contains the photos themselves too.
      const urls = new Map<string, string>();
      if (photos.length) {
        const { data: signed } = await (
          await getClient()
        ).storage
          .from(PHOTO_BUCKET)
          .createSignedUrls(
            photos.map((p) => p.storage_path),
            EXPORT_PHOTO_URL_TTL_S,
          );
        for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
      }
      const at = now();
      const withLinks = {
        ...data,
        photos: photos.map((p) => ({ ...p, download_url: urls.get(p.storage_path) ?? null })),
        photo_links_valid_until: new Date(
          at.getTime() + EXPORT_PHOTO_URL_TTL_S * 1000,
        ).toISOString(),
      };
      return {
        fileName: `cleanspot-data-${day(at)}.json`,
        json: JSON.stringify(withLinks, null, 2),
      };
    },

    async deleteAccount() {
      const paths = ((await rpc('delete_my_photos')) ?? []) as string[];
      // Best effort: files left behind are orphans and go with the next maintenance run.
      const bucket = (await getClient()).storage.from(PHOTO_BUCKET);
      for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
        try {
          await bucket.remove(paths.slice(i, i + REMOVE_BATCH));
        } catch {
          break;
        }
      }
      await rpc('delete_my_account');
    },
  };
}

/** Saves a text file through the browser's download. */
export function downloadFile({ fileName, json }: DataExport, doc: Document = document) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  doc.body.append(a);
  a.click();
  a.remove();
  // Revoke later: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Browser: a file download. Native app: the system share sheet (save to Files, Drive, …). */
export async function saveExport(file: DataExport) {
  if (isNative()) await shareTextFile(file.fileName, file.json, 'CleanSpot');
  else downloadFile(file);
}
