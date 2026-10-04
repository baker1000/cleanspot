import { createContext, useContext, useState, type ReactNode } from 'react';
import { hasBackendConfig } from '@/lib/env';
import { createSupabaseSubmitApi, type ReportSubmitApi, type SubmitClient } from './api';

const ReportSubmitApiContext = createContext<ReportSubmitApi | null>(null);

function defaultApi(): ReportSubmitApi | null {
  if (!hasBackendConfig(import.meta.env)) return null;
  // supabase-js stays code-split: loaded on the first request.
  return createSupabaseSubmitApi(() =>
    import('@/lib/supabase').then((m) => m.getSupabase() as unknown as SubmitClient),
  );
}

export function ReportSubmitApiProvider({
  api,
  children,
}: {
  /** Inject for tests; `null` = no backend. Omit to use Supabase when configured. */
  api?: ReportSubmitApi | null;
  children: ReactNode;
}) {
  const [value] = useState(() => (api === undefined ? defaultApi() : api));
  return (
    <ReportSubmitApiContext.Provider value={value}>{children}</ReportSubmitApiContext.Provider>
  );
}

/** The report submission API, or null when no backend is configured. */
export function useReportSubmitApi(): ReportSubmitApi | null {
  return useContext(ReportSubmitApiContext);
}
