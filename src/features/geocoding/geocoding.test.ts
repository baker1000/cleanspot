import { createGeocoder } from './index';
import { createNominatimGeocoder, NOMINATIM_MIN_INTERVAL_MS } from './nominatim';
import { createRateGate } from './rateGate';
import { GeocodeError, type HttpGet } from './types';

const PLACE = {
  place_id: 42,
  display_name: 'Buchholz in der Nordheide, Landkreis Harburg, Niedersachsen, Deutschland',
  lat: '53.3285',
  lon: '9.8621',
  boundingbox: ['53.28', '53.37', '9.78', '9.95'],
};

function fakeHttp(status = 200, body: unknown = [PLACE]) {
  const calls: { url: URL; headers: Record<string, string>; at: number }[] = [];
  const http = vi.fn<HttpGet>(async (url, headers) => {
    calls.push({ url: new URL(url), headers, at: Date.now() });
    return { status, json: async () => body };
  });
  return { http, calls };
}

const geocoder = (http: HttpGet, countryCodes = '') =>
  createNominatimGeocoder({ baseUrl: 'https://nominatim.example', http, countryCodes });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createRateGate', () => {
  it('spaces starts by the interval and serves callers in order', async () => {
    const gate = createRateGate(1000);
    const starts: number[] = [];
    const t0 = Date.now();
    const all = Promise.all(
      [1, 2, 3].map((n) => gate.wait().then(() => starts.push(Date.now() - t0 + n / 10))),
    );
    await vi.advanceTimersByTimeAsync(2500);
    await all;
    expect(starts).toEqual([0.1, 1000.2, 2000.3]);
  });

  it('an aborted waiter gives up its slot without delaying the next one', async () => {
    const gate = createRateGate(1000);
    const t0 = Date.now();
    await gate.wait();
    const controller = new AbortController();
    const aborted = gate.wait(controller.signal);
    const next = gate.wait().then(() => Date.now() - t0);
    controller.abort();
    await expect(aborted).rejects.toThrow(/Aborted/);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await next).toBe(1000);
  });
});

describe('Nominatim geocoder', () => {
  it('sends a policy-conform search request and maps the result', async () => {
    const { http, calls } = fakeHttp();
    const results = await geocoder(http, 'de').search('  Buchholz   Nordheide ', {
      language: 'de',
      viewbox: [9.6, 53.15, 10.35, 53.48],
    });

    expect(calls).toHaveLength(1);
    const { url, headers } = calls[0]!;
    expect(url.origin + url.pathname).toBe('https://nominatim.example/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: 'jsonv2',
      q: 'Buchholz Nordheide',
      limit: '5',
      'accept-language': 'de',
      countrycodes: 'de',
      viewbox: '9.6,53.15,10.35,53.48',
    });
    expect(headers.Accept).toBe('application/json');
    expect(results).toEqual([
      {
        id: '42',
        label: PLACE.display_name,
        lng: 9.8621,
        lat: 53.3285,
        bbox: [9.78, 53.28, 9.95, 53.37],
      },
    ]);
  });

  it('does not send a request for queries shorter than 2 characters', async () => {
    const { http } = fakeHttp();
    expect(await geocoder(http).search(' a ', { language: 'de' })).toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });

  it('caches results: the same search does not hit the server again', async () => {
    const { http } = fakeHttp();
    const g = geocoder(http);
    await g.search('Winsen', { language: 'de' });
    await g.search('winsen', { language: 'de' });
    expect(http).toHaveBeenCalledTimes(1);
    // Another language is another request (place names differ).
    const other = g.search('Winsen', { language: 'ar' });
    await vi.advanceTimersByTimeAsync(NOMINATIM_MIN_INTERVAL_MS);
    await other;
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('never sends more than one request per second, even when searches overlap', async () => {
    const { http, calls } = fakeHttp();
    const g = geocoder(http);
    const searches = ['Tostedt', 'Seevetal', 'Rosengarten'].map((q) =>
      g.search(q, { language: 'de' }),
    );
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all(searches);
    const gaps = calls.slice(1).map((c, i) => c.at - calls[i]!.at);
    expect(calls).toHaveLength(3);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(NOMINATIM_MIN_INTERVAL_MS);
  });

  it('maps HTTP and network errors to GeocodeError reasons', async () => {
    await expect(
      geocoder(fakeHttp(429).http).search('Hamburg', { language: 'de' }),
    ).rejects.toEqual(new GeocodeError('rate_limited'));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(
      geocoder(fakeHttp(503).http).search('Hamburg', { language: 'de' }),
    ).rejects.toEqual(new GeocodeError('server'));
    const failing: HttpGet = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(geocoder(failing).search('Hamburg', { language: 'de' })).rejects.toEqual(
      new GeocodeError('network'),
    );
  });

  it('lets an abort through unchanged and sends nothing', async () => {
    const { http } = fakeHttp();
    const controller = new AbortController();
    controller.abort();
    await expect(
      geocoder(http).search('Hamburg', { language: 'de', signal: controller.signal }),
    ).rejects.toThrow(/Aborted/);
    expect(http).not.toHaveBeenCalled();
  });

  it('names the data source for the attribution line', () => {
    expect(geocoder(fakeHttp().http).attribution.text).toMatch(/OpenStreetMap/);
  });
});

describe('createGeocoder', () => {
  const env = {
    mapStyleUrl: 'x',
    geocoderUrl: 'https://nominatim.example',
    geocoderCountryCodes: '',
  };

  it('returns null when search is switched off', () => {
    expect(createGeocoder({ ...env, geocoderProvider: 'none' })).toBeNull();
  });

  it('builds Nominatim against the configured URL', async () => {
    const { http, calls } = fakeHttp();
    await createGeocoder({ ...env, geocoderProvider: 'nominatim' }, http)!.search('Jesteburg', {
      language: 'en',
    });
    expect(calls[0]!.url.host).toBe('nominatim.example');
  });
});
