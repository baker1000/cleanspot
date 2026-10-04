import { createContext, useContext, useState, type ReactNode } from 'react';
import { hasBackendConfig } from '@/lib/env';
import { createSupabaseProfileApi, type ProfileApi, type ProfileClient } from './api';

const ProfileApiContext = createContext<ProfileApi | null>(null);

function defaultApi(): ProfileApi | null {
  if (!hasBackendConfig(import.meta.env)) return null;
  // supabase-js stays code-split: loaded on the first request.
  return createSupabaseProfileApi(() =>
    import('@/lib/supabase').then((m) => m.getSupabase() as unknown as ProfileClient),
  );
}

export function ProfileApiProvider({
  api,
  children,
}: {
  /** Inject for tests; `null` = no backend. Omit to use Supabase when configured. */
  api?: ProfileApi | null;
  children: ReactNode;
}) {
  const [value] = useState(() => (api === undefined ? defaultApi() : api));
  return <ProfileApiContext.Provider value={value}>{children}</ProfileApiContext.Provider>;
}

/** The profile API, or null when no backend is configured. */
export function useProfileApi(): ProfileApi | null {
  return useContext(ProfileApiContext);
}
