import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CrosshairIcon, LocateIcon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import type { GeocodeResult, Geocoder } from '@/features/geocoding';
import { LazyMapView } from '@/features/map/LazyMapView';
import { DEFAULT_VIEW } from '@/features/map/MapPage';
import type { FocusRequest, Viewport } from '@/features/map/MapView';
import { PlaceSearch } from '@/features/map/PlaceSearch';
import { loadView } from '@/features/map/viewStorage';
import { parseMapEnv } from '@/lib/env';
import { LocateFailure, locateOnce, type LocateError } from '@/lib/geolocation';

export interface PickedLocation {
  lng: number;
  lat: number;
  /** GPS accuracy in metres; null when placed by hand on the map. */
  accuracy: number | null;
}

/** Zoom level from which the crosshair is precise enough to place a report. */
export const MIN_PICK_ZOOM = 15;

/**
 * Three ways to set the location, none of which needs dragging: the device position, a place
 * search, or moving the map (also with the keyboard: arrow keys, +/-) and taking the crosshair.
 */
export function LocationPicker({
  id,
  value,
  onChange,
  error,
  geocoder,
  locate = locateOnce,
}: {
  id: string;
  value: PickedLocation | null;
  onChange(location: PickedLocation): void;
  error?: string;
  geocoder: Geocoder | null;
  locate?: typeof locateOnce;
}) {
  const { t, i18n } = useTranslation();
  const mapEnv = useMemo(() => parseMapEnv(import.meta.env), []);
  const [initialView] = useState(() => loadView() ?? DEFAULT_VIEW);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<LocateError | null>(null);
  const [mapError, setMapError] = useState<'webgl' | 'style' | null>(null);
  const focusKey = useRef(0);
  const hintId = useId();
  const errorId = useId();

  const requestFocus = (f: Omit<FocusRequest, 'key'>) => {
    focusKey.current += 1;
    setFocus({ ...f, key: focusKey.current });
  };

  async function useMyLocation() {
    setLocateError(null);
    setLocating(true);
    try {
      const pos = await locate();
      onChange({ lng: pos.lng, lat: pos.lat, accuracy: pos.accuracy });
      requestFocus({ center: [pos.lng, pos.lat], zoom: 17 });
    } catch (err) {
      setLocateError(err instanceof LocateFailure ? err.reason : 'unavailable');
    } finally {
      setLocating(false);
    }
  }

  function takeCrosshair() {
    if (!viewport) return;
    onChange({ lng: viewport.center[0], lat: viewport.center[1], accuracy: null });
  }

  function onPickPlace(result: GeocodeResult) {
    requestFocus(
      result.bbox ? { bbox: result.bbox } : { center: [result.lng, result.lat], zoom: 17 },
    );
  }

  const onMapError = useCallback((kind: 'webgl' | 'style') => setMapError(kind), []);
  const noop = useCallback(() => {}, []);

  const tooFar = viewport !== null && viewport.zoom < MIN_PICK_ZOOM;
  const coords = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 5,
    maximumFractionDigits: 5,
  });

  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-describedby={[hintId, error ? errorId : ''].filter(Boolean).join(' ')}
      className="flex flex-col gap-2 focus:outline-none"
    >
      <legend className="mb-1 text-lg font-semibold">{t('report.location.legend')}</legend>
      <p id={hintId} className="text-sm text-slate-700">
        {t('report.location.hint')}
      </p>
      {error && (
        <p id={errorId} className="text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <div>
        <Button variant="secondary" onClick={useMyLocation} loading={locating}>
          {!locating && <LocateIcon />}
          {t('report.location.useGps')}
        </Button>
      </div>
      {locateError && <Alert tone="warning">{t(`map.locate.errors.${locateError}`)}</Alert>}

      {geocoder && (
        <PlaceSearch
          nested
          geocoder={geocoder}
          viewbox={viewport?.bbox ?? null}
          onPick={onPickPlace}
        />
      )}

      {mapError !== 'webgl' && (
        <div className="relative h-72 overflow-hidden rounded-lg border border-slate-400">
          <LazyMapView
            styleUrl={mapEnv.mapStyleUrl}
            initialView={initialView}
            reports={[]}
            selectedId={null}
            userLocation={value ? { ...value, accuracy: value.accuracy ?? 0 } : null}
            focus={focus}
            label={t('report.location.mapLabel')}
            loadingLabel={t('common.loading')}
            onViewportChange={setViewport}
            onSelect={noop}
            onError={onMapError}
          />
          <CrosshairIcon
            className="pointer-events-none absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 text-slate-950 drop-shadow-[0_0_2px_white]"
            strokeWidth={2.5}
          />
        </div>
      )}
      {mapError && <Alert tone="warning">{t(`report.location.mapErrors.${mapError}`)}</Alert>}

      {mapError !== 'webgl' && (
        <div className="flex flex-col gap-1">
          <div>
            <Button variant="secondary" onClick={takeCrosshair} disabled={!viewport || tooFar}>
              <CrosshairIcon />
              {t('report.location.useCenter')}
            </Button>
          </div>
          {tooFar && <p className="text-sm text-slate-700">{t('report.location.zoomIn')}</p>}
        </div>
      )}

      <p role="status" className="font-medium text-slate-900">
        {value
          ? [
              t('report.location.set', {
                lat: coords.format(value.lat),
                lng: coords.format(value.lng),
              }),
              value.accuracy !== null &&
                t('report.location.accuracy', { meters: Math.round(value.accuracy) }),
            ]
              .filter(Boolean)
              .join(' · ')
          : t('report.location.notSet')}
      </p>
    </fieldset>
  );
}
