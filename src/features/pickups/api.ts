// Staff side of bag pickup: which tenants the user works for, the open pickup tasks of one
// (open_pickup_tasks, staff only on the server), and marking them collected or not there.
import { classifyActionError, PHOTO_URL_TTL_S, type DetailClient } from '@/features/detail/api';
import type { ReportCategory } from '@/features/map/reports';
import { PHOTO_BUCKET } from '@/features/report/api';

export interface StaffTenant {
  id: string;
  name: string;
}

export interface PickupStop {
  id: string;
  reportId: string;
  lng: number;
  lat: number;
  accuracyM: number | null;
  bagCount: number;
  estimatedKg: number | null;
  category: ReportCategory;
  createdAt: string;
  /** Signed URL of the bags photo; null if there is none or it could not be signed. */
  photoUrl: string | null;
}

export interface PickupsApi {
  /** Tenants where the user is municipality staff or admin. */
  staffTenants(userId: string): Promise<StaffTenant[]>;
  openTasks(tenantId: string, signal?: AbortSignal): Promise<PickupStop[]>;
  collect(taskId: string): Promise<void>;
  /** The bags were not there (or reported by mistake). */
  cancel(taskId: string): Promise<void>;
}

interface TaskRow {
  id: string;
  report_id: string;
  lng: number;
  lat: number;
  accuracy_m: number | null;
  bag_count: number;
  estimated_kg: number | string | null;
  photo_path: string | null;
  category: ReportCategory;
  created_at: string;
}

const STAFF_ROLES = new Set(['municipality_staff', 'municipality_admin']);

export function createSupabasePickupsApi(getClient: () => Promise<DetailClient>): PickupsApi {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await (await getClient()).rpc(fn, args);
    if (error) throw classifyActionError(error);
    return data;
  };

  return {
    async staffTenants(userId) {
      const client = await getClient();
      const { data, error } = await client
        .from('memberships')
        .select('tenant_id, role, tenants(name)')
        .eq('user_id', userId);
      if (error) throw classifyActionError(error);
      return (
        (data ?? []) as { tenant_id: string; role: string; tenants: { name: string } | null }[]
      )
        .filter((m) => STAFF_ROLES.has(m.role))
        .map((m) => ({ id: m.tenant_id, name: m.tenants?.name ?? m.tenant_id }));
    },

    async openTasks(tenantId) {
      const rows = ((await rpc('open_pickup_tasks', { p_tenant_id: tenantId })) ?? []) as TaskRow[];
      const paths = rows.map((r) => r.photo_path).filter((p): p is string => Boolean(p));
      const urls = new Map<string, string>();
      if (paths.length) {
        const client = await getClient();
        const { data } = await client.storage
          .from(PHOTO_BUCKET)
          .createSignedUrls(paths, PHOTO_URL_TTL_S);
        for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
      }
      return rows.map((r) => ({
        id: r.id,
        reportId: r.report_id,
        lng: r.lng,
        lat: r.lat,
        accuracyM: r.accuracy_m,
        bagCount: r.bag_count,
        estimatedKg: r.estimated_kg === null ? null : Number(r.estimated_kg),
        category: r.category,
        createdAt: r.created_at,
        photoUrl: (r.photo_path && urls.get(r.photo_path)) || null,
      }));
    },

    async collect(taskId) {
      await rpc('collect_pickup', { p_task_id: taskId });
    },
    async cancel(taskId) {
      await rpc('cancel_pickup', { p_task_id: taskId });
    },
  };
}
