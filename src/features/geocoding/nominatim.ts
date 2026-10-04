// Nominatim (OpenStreetMap) geocoder, following the usage policy
// (https://operations.osmfoundation.org/policies/nominatim/):
// - no autocomplete: the UI calls search() only when the user submits the form
// - at most 1 request per second per app instance (shared RateGate), results cached
// - the app identifies itself: browsers send the Referer (they may not set User-Agent);
//   the native app passes an HttpGet that sets a User-Agent (see the Capacitor step)
// - attribution is shown next to the results
import { createRateGate, type RateGate } from './rateGate';
import { GeocodeError, type Bbox, type GeocodeResult, type Geocoder, type HttpGet } from './types';

export const NOMINATIM_MIN_INTERVAL_MS = 1000;
const CACHE_SIZE = 50;
const RESULT_LIMIT = 5;

export interface NominatimOptions {
  baseUrl: string;
  /** e.g. "de" or "de,at"; empty = worldwide */
  countryCodes?: string;
  http: HttpGet;
  /** Extra headers, e.g. User-Agent on native platforms. */
  headers?: Record<string, string>;
  gate?: RateGate;
}

interface NominatimPlace {
  place_id: number | string;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function createNominatimGeocoder(options: NominatimOptions): Geocoder {
  const gate = options.gate ?? createRateGate(NOMINATIM_MIN_INTERVAL_MS);
  const cache = new Map<string, GeocodeResult[]>();
  const countryCodes = options.countryCodes ?? '';

  function buildUrl(query: string, language: string, viewbox?: Bbox) {
    const params = new URLSearchParams({
      format: 'jsonv2',
      q: query,
      limit: String(RESULT_LIMIT),
      'accept-language': language,
    });
    if (countryCodes) params.set('countrycodes', countryCodes);
    if (viewbox) params.set('viewbox', viewbox.map(round).join(','));
    return `${options.baseUrl}/search?${params}`;
  }

  return {
    attribution: {
      text: '© OpenStreetMap contributors',
      url: 'https://www.openstreetmap.org/copyright',
    },

    async search(rawQuery, { language, viewbox, signal }) {
      const query = rawQuery.trim().replace(/\s+/g, ' ');
      if (query.length < 2) return [];

      const key = [language, viewbox?.map(round).join(',') ?? '', query.toLowerCase()].join('|');
      const cached = cache.get(key);
      if (cached) return cached;

      await gate.wait(signal);
      let response;
      try {
        response = await options.http(
          buildUrl(query, language, viewbox),
          { Accept: 'application/json', ...options.headers },
          signal,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new GeocodeError('network');
      }
      if (response.status === 429 || response.status === 403)
        throw new GeocodeError('rate_limited');
      if (response.status < 200 || response.status >= 300) throw new GeocodeError('server');

      const places = (await response.json()) as NominatimPlace[];
      const results = places.map((p): GeocodeResult => {
        const b = p.boundingbox?.map(Number);
        return {
          id: String(p.place_id),
          label: p.display_name,
          lng: Number(p.lon),
          lat: Number(p.lat),
          // Nominatim order: [minLat, maxLat, minLng, maxLng]
          bbox: b && b.length === 4 ? [b[2]!, b[0]!, b[3]!, b[1]!] : undefined,
        };
      });

      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
      cache.set(key, results);
      return results;
    },
  };
}
