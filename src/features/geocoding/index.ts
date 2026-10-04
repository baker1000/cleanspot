import { parseMapEnv, type MapEnv } from '@/lib/env';
import { createNominatimGeocoder } from './nominatim';
import type { Geocoder, HttpGet } from './types';

export type { Bbox, GeocodeResult, Geocoder } from './types';
export { GeocodeError } from './types';

const browserGet: HttpGet = (url, headers, signal) =>
  // The default referrer policy sends our origin, which identifies the app to Nominatim.
  fetch(url, { headers, signal });

/** Builds the configured geocoder, or null when search is switched off. */
export function createGeocoder(env: MapEnv, http: HttpGet = browserGet): Geocoder | null {
  switch (env.geocoderProvider) {
    case 'none':
      return null;
    case 'nominatim':
      return createNominatimGeocoder({
        baseUrl: env.geocoderUrl,
        countryCodes: env.geocoderCountryCodes,
        http,
      });
  }
}

let instance: Geocoder | null | undefined;

/** App-wide instance, so the 1 request/second limit holds across all components. */
export function getGeocoder(): Geocoder | null {
  if (instance === undefined) instance = createGeocoder(parseMapEnv(import.meta.env));
  return instance;
}
