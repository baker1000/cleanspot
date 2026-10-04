import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilterIcon, ListIcon, LocateIcon, MapIcon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { getGeocoder, type Bbox, type GeocodeResult, type Geocoder } from '@/features/geocoding';
import { parseMapEnv } from '@/lib/env';
import { LazyMapView } from './LazyMapView';
import { MapFiltersPanel } from './MapFiltersPanel';
import type { FocusRequest, UserLocation, Viewport } from './MapView';
import { PlaceSearch } from './PlaceSearch';
import { ReportList } from './ReportList';
import { ReportSheet } from './ReportSheet';
import { DEFAULT_FILTERS, MAX_MAP_REPORTS, type MapFilters, type MapReport } from './reports';
import { useReportsApi } from './ReportsApiContext';
import { loadView, saveView } from './viewStorage';

/** Hamburg and Landkreis Harburg. */
export const DEFAULT_VIEW = { center: [9.95, 53.4] as [number, number], zoom: 10 };
const FETCH_DEBOUNCE_MS = 250;

type LoadState = { kind: 'idle' | 'loading' | 'ready' } | { kind: 'error' };
type LocateError = 'denied' | 'unavailable' | null;

export function MapPage({ geocoder = getGeocoder() }: { geocoder?: Geocoder | null }) {
  const { t } = useTranslation();
  const api = useReportsApi();
  const mapEnv = useMemo(() => parseMapEnv(import.meta.env), []);
  const [initialView] = useState(() => loadView() ?? DEFAULT_VIEW);

  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);
  const [reports, setReports] = useState<MapReport[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: 'idle' });
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [mapError, setMapError] = useState<'webgl' | 'style' | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<LocateError>(null);
  const focusKey = useRef(0);
  const filtersId = useId();

  const bbox = viewport?.bbox;
  const bboxKey = bbox?.join(',');

  // Load reports for the current view (debounced; a newer request aborts the older one).
  useEffect(() => {
    if (!api || !bbox) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoad({ kind: 'loading' });
      api
        .inBbox(bbox, filters, controller.signal)
        .then((rows) => {
          setReports(rows);
          setLoad({ kind: 'ready' });
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoad({ kind: 'error' });
        });
    }, FETCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, bboxKey, filters, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const onViewportChange = useCallback((v: Viewport) => {
    setViewport(v);
    saveView({ center: v.center, zoom: v.zoom });
  }, []);

  const onMapError = useCallback((kind: 'webgl' | 'style') => {
    setMapError(kind);
    if (kind === 'webgl') setMode('list');
  }, []);

  const requestFocus = (f: Omit<FocusRequest, 'key'>) => {
    focusKey.current += 1;
    setFocus({ ...f, key: focusKey.current });
  };

  function onPickPlace(result: GeocodeResult) {
    setMode('map');
    requestFocus(
      result.bbox ? { bbox: result.bbox } : { center: [result.lng, result.lat], zoom: 15 },
    );
  }

  function locate() {
    setLocateError(null);
    if (!('geolocation' in navigator)) {
      setLocateError('unavailable');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const loc = {
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
        };
        setUserLocation(loc);
        requestFocus({ center: [loc.lng, loc.lat], zoom: 15 });
      },
      (err) => {
        setLocating(false);
        setLocateError(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  const selected = reports.find((r) => r.id === selectedId) ?? null;
  const visibleCount = reports.length;
  const searchViewbox: Bbox | null = bbox ?? null;

  const toolbarButton =
    'inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-400 bg-white px-3 py-2 font-medium text-slate-900 hover:bg-slate-100 aria-[expanded=true]:bg-brand-50 aria-[pressed=true]:bg-brand-50';

  return (
    <div className="absolute inset-0 flex flex-col">
      <h1 className="sr-only">{t('map.title')}</h1>

      <div className="relative z-10 flex flex-col gap-2 border-b border-slate-200 bg-white p-2">
        {geocoder && (
          <PlaceSearch geocoder={geocoder} viewbox={searchViewbox} onPick={onPickPlace} />
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={toolbarButton}
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <FilterIcon />
            {t('map.filters.toggle')}
          </button>
          <button
            type="button"
            className={toolbarButton}
            aria-pressed={mode === 'list'}
            onClick={() => setMode((m) => (m === 'map' ? 'list' : 'map'))}
          >
            {mode === 'map' ? <ListIcon /> : <MapIcon />}
            {t('map.view.list')}
          </button>
          <Button variant="secondary" onClick={locate} loading={locating}>
            {!locating && <LocateIcon />}
            {t('map.locate.button')}
          </Button>
        </div>
        {!api && <Alert tone="warning">{t('errors.backendNotConfigured')}</Alert>}
        {locateError && <Alert tone="warning">{t(`map.locate.errors.${locateError}`)}</Alert>}
        {mapError && <Alert tone="warning">{t(`map.errors.${mapError}`)}</Alert>}
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div
          className={`absolute inset-0 ${mode === 'list' ? 'invisible' : ''}`}
          aria-hidden={mode === 'list'}
        >
          {mapError !== 'webgl' && (
            <LazyMapView
              styleUrl={mapEnv.mapStyleUrl}
              initialView={initialView}
              reports={reports}
              selectedId={selectedId}
              userLocation={userLocation}
              focus={focus}
              label={t('map.mapLabel')}
              loadingLabel={t('common.loading')}
              onViewportChange={onViewportChange}
              onSelect={setSelectedId}
              onError={onMapError}
            />
          )}
        </div>

        {mode === 'list' && (
          <div className="absolute inset-0 overflow-y-auto bg-white">
            <ReportList
              reports={reports}
              center={viewport?.center ?? null}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        )}

        {filtersOpen && (
          <div className="absolute inset-x-0 top-0 z-10 max-h-full overflow-y-auto p-2">
            <MapFiltersPanel id={filtersId} filters={filters} onChange={setFilters} />
          </div>
        )}

        {/* pb-8 keeps the map attribution line below uncovered. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-start gap-2 px-2 pt-2 pb-8">
          {api && !selected && (
            <div className="pointer-events-auto">
              {load.kind === 'error' ? (
                <Alert tone="error">
                  <span className="me-2">{t('map.loadError')}</span>
                  <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
                    {t('common.retry')}
                  </Button>
                </Alert>
              ) : (
                <p
                  role="status"
                  className="rounded-full bg-white/95 px-3 py-1 text-sm font-medium text-slate-900 shadow"
                >
                  {load.kind === 'loading' || load.kind === 'idle' ? (
                    <Spinner size="sm" label={t('map.loading')} />
                  ) : visibleCount >= MAX_MAP_REPORTS ? (
                    t('map.tooMany', { count: MAX_MAP_REPORTS })
                  ) : (
                    t('map.count', { count: visibleCount })
                  )}
                </p>
              )}
            </div>
          )}
          {selected && <ReportSheet report={selected} onClose={() => setSelectedId(null)} />}
        </div>
      </div>
    </div>
  );
}
