import { createContext, useContext, useState, type ReactNode } from 'react';
import { hasBackendConfig } from '@/lib/env';
import { createSupabaseReportsApi, type ReportsApi, type RpcClient } from './reports';

const ReportsApiContext = createContext<ReportsApi | null>(null);

function defaultApi(): ReportsApi | null {
  if (!hasBackendConfig(import.meta.env)) return null;
  // supabase-js stays code-split: loaded on the first request.
  return createSupabaseReportsApi(() =>
    import('@/lib/supabase').then((m) => m.getSupabase() as unknown as RpcClient),
  );
}

export function ReportsApiProvider({
  api,
  children,
}: {
  /** Inject for tests; `null` = no backend. Omit to use Supabase when configured. */
  api?: ReportsApi | null;
  children: ReactNode;
}) {
  const [value] = useState(() => (api === undefined ? defaultApi() : api));
  return <ReportsApiContext.Provider value={value}>{children}</ReportsApiContext.Provider>;
}

/** The reports API, or null when no backend is configured. */
export function useReportsApi(): ReportsApi | null {
  return useContext(ReportsApiContext);
}
