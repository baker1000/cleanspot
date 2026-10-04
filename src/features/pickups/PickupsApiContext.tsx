import { createContext, useContext, useState, type ReactNode } from 'react';
import type { DetailClient } from '@/features/detail/api';
import { hasBackendConfig } from '@/lib/env';
import { createSupabasePickupsApi, type PickupsApi } from './api';

const PickupsApiContext = createContext<PickupsApi | null>(null);

function defaultApi(): PickupsApi | null {
  if (!hasBackendConfig(import.meta.env)) return null;
  // supabase-js stays code-split: loaded on the first request.
  return createSupabasePickupsApi(() =>
    import('@/lib/supabase').then((m) => m.getSupabase() as unknown as DetailClient),
  );
}

export function PickupsApiProvider({
  api,
  children,
}: {
  /** Inject for tests; `null` = no backend. Omit to use Supabase when configured. */
  api?: PickupsApi | null;
  children: ReactNode;
}) {
  const [value] = useState(() => (api === undefined ? defaultApi() : api));
  return <PickupsApiContext.Provider value={value}>{children}</PickupsApiContext.Provider>;
}

/** The pickup API, or null when no backend is configured. */
export function usePickupsApi(): PickupsApi | null {
  return useContext(PickupsApiContext);
}
