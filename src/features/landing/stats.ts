// Live numbers for the landing page (public_stats, migration 9). Plain fetch instead of
// supabase-js, so the landing page stays small; a GET, so the service worker can cache it.

export interface PublicStats {
  reports: number;
  open: number;
  cleared: number;
  clearedLast30Days: number;
  kgCleared: number;
  municipalities: number;
}

export interface PublicStatsApi {
  load(signal?: AbortSignal): Promise<PublicStats>;
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function createPublicStatsApi(
  supabaseUrl: string,
  anonKey: string,
  fetchFn: typeof fetch = (...args) => fetch(...args),
): PublicStatsApi {
  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/public_stats`;
  return {
    async load(signal) {
      const response = await fetchFn(endpoint, {
        headers: { apikey: anonKey, accept: 'application/json' },
        signal,
      });
      if (!response.ok) throw new Error(`public_stats: HTTP ${response.status}`);
      const raw = (await response.json()) as Record<string, unknown>;
      return {
        reports: num(raw.reports),
        open: num(raw.open),
        cleared: num(raw.cleared),
        clearedLast30Days: num(raw.cleared_last_30_days),
        kgCleared: num(raw.kg_cleared),
        municipalities: num(raw.municipalities),
      };
    },
  };
}
