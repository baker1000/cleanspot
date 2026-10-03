import { parseEnv } from './env';

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
