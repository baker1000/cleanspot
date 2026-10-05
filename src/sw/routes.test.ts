import { describe, expect, it } from 'vitest';
import { cacheFor, type RouteEnv } from './routes';

const env: RouteEnv = {
  mapStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  supabaseUrl: 'https://abc.supabase.co',
};
const at = (href: string, e = env) => cacheFor(new URL(href), e);

describe('service worker cache routes', () => {
  it('style and TileJSON: network first', () => {
    expect(at('https://tiles.openfreemap.org/styles/liberty')).toBe('map-style');
    expect(at('https://tiles.openfreemap.org/planet')).toBe('map-style');
  });

  it('tiles, glyphs and sprites: cache first', () => {
    expect(at('https://tiles.openfreemap.org/planet/20260901_001001_pt/14/8650/5302.pbf')).toBe(
      'map-tiles',
    );
    expect(at('https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf')).toBe(
      'map-tiles',
    );
    expect(at('https://tiles.openfreemap.org/sprites/ofm_f384/ofm@2x.png')).toBe('map-tiles');
  });

  it('a style file with an extension is still the style', () => {
    const e = { ...env, mapStyleUrl: 'https://tiles.example.org/style.json' };
    expect(at('https://tiles.example.org/style.json', e)).toBe('map-style');
    expect(at('https://tiles.example.org/sprite.json', e)).toBe('map-tiles');
  });

  it('public statistics, but no other backend call', () => {
    expect(at('https://abc.supabase.co/rest/v1/rpc/public_stats')).toBe('stats');
    expect(at('https://abc.supabase.co/rest/v1/rpc/reports_in_bbox')).toBeNull();
    expect(at('https://abc.supabase.co/storage/v1/object/sign/report-photos/x.webp')).toBeNull();
    expect(
      at('https://abc.supabase.co/rest/v1/rpc/public_stats', { ...env, supabaseUrl: null }),
    ).toBeNull();
  });

  it('nothing else (geocoder, other hosts)', () => {
    expect(at('https://nominatim.openstreetmap.org/search?q=x')).toBeNull();
    expect(at('https://tiles.openfreemap.org.evil.example/x.pbf')).toBeNull();
  });
});
