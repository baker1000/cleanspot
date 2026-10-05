import { createContext, useContext, useState, type ReactNode } from 'react';
import { hasBackendConfig, parseEnv, parsePlayStoreUrl } from '@/lib/env';
import { createPublicStatsApi, type PublicStatsApi } from './stats';

export interface LandingConfig {
  /** null = no backend: the statistics section is not shown. */
  stats: PublicStatsApi | null;
  /** null = the Android app is not published yet. */
  playStoreUrl: string | null;
}

const LandingContext = createContext<LandingConfig>({ stats: null, playStoreUrl: null });

function defaultConfig(): LandingConfig {
  const env = import.meta.env;
  const backend = hasBackendConfig(env) ? parseEnv(env) : null;
  return {
    stats: backend && createPublicStatsApi(backend.supabaseUrl, backend.supabaseAnonKey),
    playStoreUrl: parsePlayStoreUrl(env),
  };
}

export function LandingProvider({
  config,
  children,
}: {
  /** Inject for tests. Omit to use the env configuration. */
  config?: LandingConfig;
  children: ReactNode;
}) {
  const [value] = useState(() => config ?? defaultConfig());
  return <LandingContext.Provider value={value}>{children}</LandingContext.Provider>;
}

export const useLandingConfig = () => useContext(LandingContext);
