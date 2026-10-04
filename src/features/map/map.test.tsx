import { act, screen, waitFor, within } from '@testing-library/react';
import type { Geocoder, GeocodeResult } from '@/features/geocoding';
import { GeocodeError } from '@/features/geocoding';
import { fakeMap, viewportAround } from '@/test/fakeMapView';
import { renderWithProviders } from '@/test/render';
import { DEFAULT_VIEW, MapPage } from './MapPage';
import {
  CATEGORIES,
  createSupabaseReportsApi,
  DEFAULT_FILTERS,
  MAP_STATUSES,
  normalizeBbox,
  toFeatureCollection,
  type MapReport,
  type ReportsApi,
  type RpcClient,
} from './reports';
import { loadView, saveView } from './viewStorage';

const [LNG, LAT] = DEFAULT_VIEW.center;

function report(id: string, overrides: Partial<MapReport> = {}): MapReport {
  return {
    id,
    lng: LNG,
    lat: LAT,
    status: 'reported',
    category: 'bulky',
    isHazardous: false,
    size: 'pile',
    confirmationCount: 0,
    isClaimed: false,
    reportedByMe: false,
    createdAt: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

function fakeApi(rows: MapReport[] = [report('r1')]) {
  const inBbox = vi.fn<ReportsApi['inBbox']>(async () => rows);
  return { inBbox } satisfies ReportsApi;
}

function fakeGeocoder(results: GeocodeResult[] = []) {
  const search = vi.fn<Geocoder['search']>(async () => results);
  return {
    search,
    attribution: { text: '© OpenStreetMap contributors', url: 'https://osm.example/copyright' },
  } satisfies Geocoder;
}

function renderMap(opts: { api?: ReportsApi | null; geocoder?: Geocoder | null } = {}) {
  const api = opts.api === undefined ? fakeApi() : opts.api;
  return renderWithProviders(<MapPage geocoder={opts.geocoder ?? null} />, {
    route: '/app',
    reportsApi: api,
  });
}

describe('MapPage', () => {
  it('loads the reports in the current view and shows them on the map', async () => {
    const api = fakeApi([report('r1'), report('r2')]);
    renderMap({ api });
    expect(await screen.findByText('2 Meldungen in diesem Ausschnitt')).toBeInTheDocument();
    expect(api.inBbox).toHaveBeenCalledTimes(1);
    const [bbox, filters] = api.inBbox.mock.calls[0]!;
    expect(bbox).toEqual(viewportAround(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom).bbox);
    expect(filters).toEqual(DEFAULT_FILTERS);
    expect(screen.getByRole('button', { name: 'marker r2' })).toBeInTheDocument();
  });

  it('debounces viewport changes into one request for the last view', async () => {
    const api = fakeApi();
    renderMap({ api });
    await screen.findByText('1 Meldung in diesem Ausschnitt');
    api.inBbox.mockClear();
    // Separate acts = separate renders, like real map moves.
    for (const lng of [10.0, 10.1, 10.2])
      act(() => fakeMap.emitViewport(viewportAround([lng, 53.3])));
    await waitFor(() => expect(api.inBbox).toHaveBeenCalledTimes(1));
    expect(api.inBbox.mock.calls[0]![0]).toEqual(viewportAround([10.2, 53.3]).bbox);
  });

  it('opens a preview sheet for a marker, moves focus to it and closes with Escape', async () => {
    const api = fakeApi([report('r1', { confirmationCount: 2, size: 'truck' })]);
    const { user } = renderMap({ api });
    await user.click(await screen.findByRole('button', { name: 'marker r1' }));

    const sheet = screen.getByRole('region', { name: 'Sperrmüll' });
    expect(within(sheet).getByRole('heading', { name: 'Sperrmüll' })).toHaveFocus();
    expect(sheet).toHaveTextContent('Gemeldet');
    expect(sheet).toHaveTextContent('LKW-Ladung');
    expect(sheet).toHaveTextContent('2 Bestätigungen');
    expect(within(sheet).getByRole('link', { name: 'Details ansehen' })).toHaveAttribute(
      'href',
      '/app/reports/r1',
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Sperrmüll' })).not.toBeInTheDocument();
  });

  it('warns not to touch hazardous waste', async () => {
    const api = fakeApi([report('h1', { category: 'hazardous', isHazardous: true })]);
    const { user } = renderMap({ api });
    await user.click(await screen.findByRole('button', { name: 'marker h1' }));
    expect(screen.getByText('Gefährlicher Abfall: Bitte nicht berühren.')).toBeInTheDocument();
  });

  it('reloads with the chosen filters', async () => {
    const api = fakeApi();
    const { user } = renderMap({ api });
    await screen.findByText('1 Meldung in diesem Ausschnitt');

    const toggle = screen.getByRole('button', { name: 'Filter' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('checkbox', { name: 'Beseitigt' }));
    await user.click(screen.getByRole('checkbox', { name: 'Elektroschrott' }));

    await waitFor(() => {
      const filters = api.inBbox.mock.lastCall![1];
      expect(filters.statuses).toContain('cleared');
      expect(filters.categories).not.toContain('electronics');
    });
  });

  it('offers a list view as a text alternative, nearest report first', async () => {
    const api = fakeApi([
      report('far', { lng: LNG + 0.04, category: 'plastic' }),
      report('near', { lng: LNG + 0.001, category: 'electronics', isHazardous: true }),
    ]);
    const { user } = renderMap({ api });
    await screen.findByText('2 Meldungen in diesem Ausschnitt');

    const listToggle = screen.getByRole('button', { name: 'Liste' });
    await user.click(listToggle);
    expect(listToggle).toHaveAttribute('aria-pressed', 'true');
    const items = within(screen.getByRole('list', { name: 'Meldungen in diesem Ausschnitt' }))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(items[0]).toMatch(/^Elektroschrott.*Gefährlich.*70 m$/);
    expect(items[1]).toMatch(/^Kunststoff.*2,7 km$/);

    await user.click(screen.getAllByRole('button', { name: /Elektroschrott/ })[0]!);
    expect(screen.getByRole('heading', { name: 'Elektroschrott' })).toHaveFocus();
  });

  it('shows an error with a retry button when loading fails', async () => {
    const api = fakeApi();
    api.inBbox.mockRejectedValueOnce(new Error('boom'));
    const { user } = renderMap({ api });
    expect(await screen.findByText('Meldungen konnten nicht geladen werden.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('1 Meldung in diesem Ausschnitt')).toBeInTheDocument();
    expect(api.inBbox).toHaveBeenCalledTimes(2);
  });

  it('without a backend: shows the warning and sends no requests', () => {
    renderMap({ api: null });
    expect(screen.getByRole('alert')).toHaveTextContent('Der Server ist nicht eingerichtet');
    expect(screen.getByRole('region', { name: 'Karte der Meldungen' })).toBeInTheDocument();
  });
});

describe('place search', () => {
  const result: GeocodeResult = {
    id: '1',
    label: 'Winsen (Luhe), Landkreis Harburg',
    lng: 10.21,
    lat: 53.36,
    bbox: [10.15, 53.33, 10.27, 53.39],
  };

  it('searches only on submit, then lists results with attribution', async () => {
    const geocoder = fakeGeocoder([result]);
    const { user } = renderMap({ geocoder });
    await screen.findByText('1 Meldung in diesem Ausschnitt');

    await user.type(screen.getByRole('searchbox', { name: 'Ort suchen' }), 'Winsen');
    expect(geocoder.search).not.toHaveBeenCalled(); // no autocomplete

    await user.click(screen.getByRole('button', { name: 'Suchen' }));
    expect(geocoder.search).toHaveBeenCalledTimes(1);
    const [query, options] = geocoder.search.mock.calls[0]!;
    expect(query).toBe('Winsen');
    expect(options.language).toBe('de');
    expect(options.viewbox).toEqual(viewportAround(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom).bbox);

    expect(await screen.findByText('1 Treffer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '© OpenStreetMap contributors' })).toHaveAttribute(
      'href',
      'https://osm.example/copyright',
    );

    await user.click(screen.getByRole('button', { name: result.label }));
    expect(JSON.parse(screen.getByTestId('map-focus').textContent!)).toMatchObject({
      bbox: result.bbox,
    });
    expect(screen.queryByRole('button', { name: result.label })).not.toBeInTheDocument();
  });

  it('explains rate limiting and does not search for a single character', async () => {
    const geocoder = fakeGeocoder();
    geocoder.search.mockRejectedValueOnce(new GeocodeError('rate_limited'));
    const { user } = renderMap({ geocoder });
    const box = screen.getByRole('searchbox', { name: 'Ort suchen' });

    await user.type(box, 'W{Enter}');
    expect(geocoder.search).not.toHaveBeenCalled();

    await user.type(box, 'insen{Enter}');
    expect(
      await screen.findByText('Zu viele Suchanfragen. Bitte warten Sie einen Moment.'),
    ).toBeInTheDocument();
  });

  it('is hidden when the provider is switched off', () => {
    renderMap({ geocoder: null });
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });
});

describe('my location', () => {
  function mockGeolocation(impl: Geolocation['getCurrentPosition']) {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: vi.fn(impl) },
    });
  }
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'geolocation');
  });

  it('asks only on click, then shows and centres the position', async () => {
    mockGeolocation((ok) =>
      ok({ coords: { longitude: 9.9, latitude: 53.5, accuracy: 12 } } as GeolocationPosition),
    );
    const { user } = renderMap();
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Mein Standort' }));
    expect(screen.getByTestId('map-user')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('map-focus').textContent!)).toMatchObject({
      center: [9.9, 53.5],
    });
  });

  it('explains a denied permission', async () => {
    mockGeolocation((_ok, fail) =>
      fail!({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    const { user } = renderMap();
    await user.click(screen.getByRole('button', { name: 'Mein Standort' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Der Standortzugriff wurde verweigert');
  });
});

describe('reports data helpers', () => {
  function fakeRpc(data: unknown[] = []) {
    const rpc = vi.fn((_fn: string, _args: Record<string, unknown>) => {
      const result = Promise.resolve({ data, error: null });
      return Object.assign(result, { abortSignal: () => result });
    });
    return { rpc, client: { rpc } as unknown as RpcClient };
  }

  it('sends null for "all selected" filters and maps rows', async () => {
    const { rpc, client } = fakeRpc([
      {
        id: 'a',
        lng: 9.9,
        lat: 53.4,
        status: 'confirmed',
        category: 'mixed',
        is_hazardous: false,
        size: 'bag',
        confirmation_count: 1,
        is_claimed: true,
        reported_by_me: false,
        created_at: '2026-10-01T00:00:00Z',
      },
    ]);
    const api = createSupabaseReportsApi(async () => client);
    const rows = await api.inBbox([9, 53, 10, 54], {
      statuses: [...MAP_STATUSES],
      categories: [...CATEGORIES],
    });
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_min_lng: 9,
      p_max_lat: 54,
      p_statuses: null,
      p_categories: null,
      p_limit: 2000,
    });
    expect(rows[0]).toMatchObject({ id: 'a', confirmationCount: 1, isClaimed: true });

    await api.inBbox([9, 53, 10, 54], { statuses: ['reported'], categories: ['bulky'] });
    expect(rpc.mock.calls[1]![1]).toMatchObject({
      p_statuses: ['reported'],
      p_categories: ['bulky'],
    });
  });

  it('does not call the server when a filter group is empty', async () => {
    const { rpc, client } = fakeRpc();
    const api = createSupabaseReportsApi(async () => client);
    expect(await api.inBbox([9, 53, 10, 54], { statuses: [], categories: ['bulky'] })).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('clamps zoomed-out viewports to valid coordinates', () => {
    expect(normalizeBbox([-200, -95, 200, 95])).toEqual([-180, -90, 180, 90]);
    expect(normalizeBbox([170, 50, 190, 60])).toEqual([170, 50, 180, 60]);
  });

  it('builds point features for the clustered source', () => {
    const fc = toFeatureCollection([report('x', { isHazardous: true })]);
    expect(fc.features[0]).toMatchObject({
      geometry: { coordinates: [LNG, LAT] },
      properties: { id: 'x', status: 'reported', hazardous: true },
    });
  });

  it('remembers the map view and ignores broken stored values', () => {
    saveView({ center: [9.9, 53.4], zoom: 12 });
    expect(loadView()).toEqual({ center: [9.9, 53.4], zoom: 12 });
    localStorage.setItem('cleanspot.mapView', '{"center":[999,1],"zoom":3}');
    expect(loadView()).toBeNull();
    localStorage.setItem('cleanspot.mapView', 'not json');
    expect(loadView()).toBeNull();
  });
});
