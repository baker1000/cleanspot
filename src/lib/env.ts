export type GeocoderProvider = 'nominatim' | 'none';

/** Map and geocoding settings. Always available, also without a backend. */
export interface MapEnv {
  mapStyleUrl: string;
  geocoderProvider: GeocoderProvider;
  geocoderUrl: string;
  /** Optional ISO 3166-1 alpha-2 list, e.g. "de" or "de,at". Empty = worldwide. */
  geocoderCountryCodes: string;
}

export interface AppEnv extends MapEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  demoMode: boolean;
}

type RawEnv = Record<string, string | boolean | undefined>;

const GEOCODER_PROVIDERS: readonly GeocoderProvider[] = ['nominatim', 'none'];

function reader(raw: RawEnv) {
  return (key: string, fallback?: string): string => {
    const value = raw[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing environment variable ${key} (see .env.example)`);
  };
}

/** Parses the map/geocoder env. Never throws for missing values; rejects unknown providers. */
export function parseMapEnv(raw: RawEnv): MapEnv {
  const str = reader(raw);
  const provider = str('VITE_GEOCODER_PROVIDER', 'nominatim').toLowerCase();
  if (!GEOCODER_PROVIDERS.includes(provider as GeocoderProvider)) {
    throw new Error(
      `VITE_GEOCODER_PROVIDER must be one of ${GEOCODER_PROVIDERS.join(', ')}, got: ${provider}`,
    );
  }
  return {
    mapStyleUrl: str('VITE_MAP_STYLE_URL', 'https://tiles.openfreemap.org/styles/liberty'),
    geocoderProvider: provider as GeocoderProvider,
    geocoderUrl: str('VITE_GEOCODER_URL', 'https://nominatim.openstreetmap.org').replace(
      /\/+$/,
      '',
    ),
    geocoderCountryCodes: str('VITE_GEOCODER_COUNTRYCODES', '').toLowerCase(),
  };
}

/** True when the backend env is complete; the app runs without it (landing page, map only). */
export function hasBackendConfig(raw: RawEnv): boolean {
  try {
    parseEnv(raw);
    return true;
  } catch {
    return false;
  }
}

/** Parses and validates the VITE_* env. Throws with a readable message on misconfiguration. */
export function parseEnv(raw: RawEnv): AppEnv {
  const str = reader(raw);
  const supabaseUrl = str('VITE_SUPABASE_URL');
  try {
    new URL(supabaseUrl);
  } catch {
    throw new Error(`VITE_SUPABASE_URL is not a valid URL: ${supabaseUrl}`);
  }

  return {
    ...parseMapEnv(raw),
    supabaseUrl,
    supabaseAnonKey: str('VITE_SUPABASE_ANON_KEY'),
    demoMode: raw.VITE_DEMO_MODE === 'true' || raw.VITE_DEMO_MODE === true,
  };
}

/**
 * Demo mode (VITE_DEMO_MODE=true): a notice that the data is invented and a switcher for the
 * demo accounts, which all share VITE_DEMO_PASSWORD (written by `npm run demo -- seed`). The
 * password is public in such a build, so only demo projects may be built this way.
 * Needs a backend and a password; otherwise demo mode is off.
 */
export function parseDemoConfig(raw: RawEnv): { password: string } | null {
  if (!hasBackendConfig(raw) || !parseEnv(raw).demoMode) return null;
  const password = raw.VITE_DEMO_PASSWORD;
  return typeof password === 'string' && password.trim() !== ''
    ? { password: password.trim() }
    : null;
}

/** Google Play listing of the Android app; only a real Play Store URL is accepted. */
export function parsePlayStoreUrl(raw: RawEnv): string | null {
  const value = raw.VITE_PLAY_STORE_URL;
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname === 'play.google.com' ? url.href : null;
  } catch {
    return null;
  }
}
