import { parseEnv, parseMapEnv, parsePlayStoreUrl } from './env';

const base = { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'anon' };

describe('parseEnv', () => {
  it('applies defaults for optional values', () => {
    const env = parseEnv(base);
    expect(env.mapStyleUrl).toContain('openfreemap');
    expect(env.demoMode).toBe(false);
  });

  it('throws on missing required values', () => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: 'http://x' })).toThrow(/VITE_SUPABASE_ANON_KEY/);
  });

  it('throws on an invalid URL', () => {
    expect(() => parseEnv({ ...base, VITE_SUPABASE_URL: 'not a url' })).toThrow(/valid URL/);
  });

  it('enables demo mode only for the literal "true"', () => {
    expect(parseEnv({ ...base, VITE_DEMO_MODE: 'true' }).demoMode).toBe(true);
    expect(parseEnv({ ...base, VITE_DEMO_MODE: '1' }).demoMode).toBe(false);
  });
});

describe('parseMapEnv', () => {
  it('works without any backend variables', () => {
    expect(parseMapEnv({})).toEqual({
      mapStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
      geocoderProvider: 'nominatim',
      geocoderUrl: 'https://nominatim.openstreetmap.org',
      geocoderCountryCodes: '',
    });
  });

  it('accepts a configured provider, strips trailing slashes and rejects unknown providers', () => {
    const env = parseMapEnv({
      VITE_GEOCODER_PROVIDER: 'None',
      VITE_GEOCODER_URL: 'https://geo.example.org/',
      VITE_GEOCODER_COUNTRYCODES: 'DE',
    });
    expect(env.geocoderProvider).toBe('none');
    expect(env.geocoderUrl).toBe('https://geo.example.org');
    expect(env.geocoderCountryCodes).toBe('de');
    expect(() => parseMapEnv({ VITE_GEOCODER_PROVIDER: 'google' })).toThrow(/must be one of/);
  });
});

describe('parsePlayStoreUrl', () => {
  it('accepts only https Play Store links', () => {
    const url = 'https://play.google.com/store/apps/details?id=store.thinktools.cleanspot';
    expect(parsePlayStoreUrl({ VITE_PLAY_STORE_URL: url })).toBe(url);
    expect(parsePlayStoreUrl({})).toBeNull();
    expect(parsePlayStoreUrl({ VITE_PLAY_STORE_URL: 'http://play.google.com/x' })).toBeNull();
    expect(parsePlayStoreUrl({ VITE_PLAY_STORE_URL: 'https://evil.example/x' })).toBeNull();
    expect(parsePlayStoreUrl({ VITE_PLAY_STORE_URL: 'javascript:alert(1)' })).toBeNull();
  });
});
