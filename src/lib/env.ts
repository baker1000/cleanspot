export interface AppEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  mapStyleUrl: string;
  geocoderUrl: string;
  demoMode: boolean;
}

type RawEnv = Record<string, string | boolean | undefined>;

/** Parses and validates the VITE_* env. Throws with a readable message on misconfiguration. */
export function parseEnv(raw: RawEnv): AppEnv {
  const str = (key: string, fallback?: string): string => {
    const value = raw[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing environment variable ${key} (see .env.example)`);
  };

  const supabaseUrl = str('VITE_SUPABASE_URL');
  try {
    new URL(supabaseUrl);
  } catch {
    throw new Error(`VITE_SUPABASE_URL is not a valid URL: ${supabaseUrl}`);
  }

  return {
    supabaseUrl,
    supabaseAnonKey: str('VITE_SUPABASE_ANON_KEY'),
    mapStyleUrl: str('VITE_MAP_STYLE_URL', 'https://tiles.openfreemap.org/styles/liberty'),
    geocoderUrl: str('VITE_GEOCODER_URL', 'https://nominatim.openstreetmap.org'),
    demoMode: raw.VITE_DEMO_MODE === 'true' || raw.VITE_DEMO_MODE === true,
  };
}
