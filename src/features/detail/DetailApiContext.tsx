import { createContext, useContext, useState, type ReactNode } from 'react';
import { hasBackendConfig } from '@/lib/env';
import { createSupabaseDetailApi, type DetailApi, type DetailClient } from './api';

const DetailApiContext = createContext<DetailApi | null>(null);

function defaultApi(): DetailApi | null {
  if (!hasBackendConfig(import.meta.env)) return null;
  // supabase-js stays code-split: loaded on the first request.
  return createSupabaseDetailApi(() =>
    import('@/lib/supabase').then((m) => m.getSupabase() as unknown as DetailClient),
  );
}

export function DetailApiProvider({
  api,
  children,
}: {
  /** Inject for tests; `null` = no backend. Omit to use Supabase when configured. */
  api?: DetailApi | null;
  children: ReactNode;
}) {
  const [value] = useState(() => (api === undefined ? defaultApi() : api));
  return <DetailApiContext.Provider value={value}>{children}</DetailApiContext.Provider>;
}

/** The report detail API, or null when no backend is configured. */
export function useDetailApi(): DetailApi | null {
  return useContext(DetailApiContext);
}
