/** [minLng, minLat, maxLng, maxLat] */
export type Bbox = [number, number, number, number];

export interface GeocodeResult {
  id: string;
  label: string;
  lng: number;
  lat: number;
  bbox?: Bbox;
}

export interface SearchOptions {
  /** UI language, sent so place names come back in it where available. */
  language: string;
  /** Current map view: results inside it are preferred, not required. */
  viewbox?: Bbox;
  signal?: AbortSignal;
}

export interface Geocoder {
  search(query: string, options: SearchOptions): Promise<GeocodeResult[]>;
  /** Must be shown next to search results (provider terms). */
  attribution: { text: string; url: string };
}

export type GeocodeErrorReason = 'rate_limited' | 'network' | 'server';

export class GeocodeError extends Error {
  constructor(readonly reason: GeocodeErrorReason) {
    super(`Geocoding failed: ${reason}`);
    this.name = 'GeocodeError';
  }
}

/** Minimal HTTP GET so the native app can swap in CapacitorHttp (which may set User-Agent). */
export type HttpGet = (
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
) => Promise<{ status: number; json(): Promise<unknown> }>;
