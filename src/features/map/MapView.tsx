// MapLibre wrapper. Loaded lazily (see LazyMapView) so the ~250 kB map library is not part of the
// first page load. Everything the page needs goes through props/callbacks; no map state leaks.
import type { FeatureCollection } from 'geojson';
import {
  Map as MapLibreMap,
  NavigationControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type ErrorEvent,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre looks for its worker next to its own file, which does not exist after bundling.
// Vite bundles the worker separately and gives us its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Bbox } from '@/features/geocoding';
import { STATUS_COLORS, toFeatureCollection, type MapReport } from './reports';

export interface Viewport {
  bbox: Bbox;
  center: [number, number];
  zoom: number;
}

/** A request to move the map. `key` changes for every request, so repeats are honoured. */
export interface FocusRequest {
  key: number;
  bbox?: Bbox;
  center?: [number, number];
  zoom?: number;
}

export interface UserLocation {
  lng: number;
  lat: number;
  accuracy: number;
}

export interface MapViewProps {
  styleUrl: string;
  initialView: { center: [number, number]; zoom: number };
  reports: MapReport[];
  selectedId: string | null;
  userLocation: UserLocation | null;
  focus: FocusRequest | null;
  /** Accessible name of the map region. */
  label: string;
  onViewportChange(viewport: Viewport): void;
  onSelect(id: string | null): void;
  onError(kind: 'webgl' | 'style'): void;
}

setWorkerUrl(workerUrl);

const SOURCE = 'reports';
const USER_SOURCE = 'user-location';
const BRAND = '#15803d'; // --color-brand-700
const CLUSTER_MAX_ZOOM = 14;

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

function userFeature(loc: UserLocation | null): FeatureCollection {
  if (!loc) return empty();
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
        properties: {},
      },
    ],
  };
}

function viewportOf(map: MapLibreMap): Viewport {
  const b = map.getBounds();
  const c = map.getCenter();
  return {
    bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
    center: [c.lng, c.lat],
    zoom: map.getZoom(),
  };
}

function addLayers(map: MapLibreMap) {
  map.addSource(SOURCE, {
    type: 'geojson',
    data: empty(),
    cluster: true,
    clusterRadius: 50,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
  });
  map.addSource(USER_SOURCE, { type: 'geojson', data: empty() });

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': BRAND,
      'circle-opacity': 0.9,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26, 200, 32],
    },
  });
  // Cluster counts need the style's glyphs; without them the circles alone still work.
  if (map.getStyle().glyphs) {
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 13,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#ffffff' },
    });
  }
  map.addLayer({
    id: 'report-points',
    type: 'circle',
    source: SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': [
        'match',
        ['get', 'status'],
        ...Object.entries(STATUS_COLORS).flat(),
        '#555555',
      ] as unknown as ExpressionSpecification,
      'circle-radius': 9,
      // Hazardous reports get a thick dark ring.
      'circle-stroke-color': ['case', ['get', 'hazardous'], '#111111', '#ffffff'],
      'circle-stroke-width': ['case', ['get', 'hazardous'], 4, 2],
    },
  });
  map.addLayer({
    id: 'report-selected',
    type: 'circle',
    source: SOURCE,
    filter: ['==', ['get', 'id'], ''],
    paint: {
      'circle-radius': 15,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#111111',
      'circle-stroke-width': 3,
    },
  });
  map.addLayer({
    id: 'user-location',
    type: 'circle',
    source: USER_SOURCE,
    paint: {
      'circle-radius': 8,
      'circle-color': '#2563eb',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });
}

export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  // Latest props for event handlers registered once.
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style: propsRef.current.styleUrl,
        center: propsRef.current.initialView.center,
        zoom: propsRef.current.initialView.zoom,
        // Attribution always visible (OSM attribution guidelines), not collapsed behind an icon.
        attributionControl: { compact: false },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch {
      propsRef.current.onError('webgl');
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      addLayers(map);
      loadedRef.current = true;
      syncData(map, propsRef.current);
      propsRef.current.onViewportChange(viewportOf(map));
    });
    map.on('error', (e: ErrorEvent) => {
      // Style/tile failures; the list view keeps working.
      if (!loadedRef.current && e.error) propsRef.current.onError('style');
    });
    map.on('moveend', () => {
      if (loadedRef.current) propsRef.current.onViewportChange(viewportOf(map));
    });

    map.on('click', 'clusters', (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id as number | undefined;
      if (clusterId === undefined || feature?.geometry.type !== 'Point') return;
      const coords = feature.geometry.coordinates as [number, number];
      void (map.getSource(SOURCE) as GeoJSONSource)
        .getClusterExpansionZoom(clusterId)
        .then((zoom) => map.easeTo({ center: coords, zoom }));
    });
    map.on('click', (e: MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['report-points'] })[0];
      if (hit) propsRef.current.onSelect(String(hit.properties.id));
      else if (!map.queryRenderedFeatures(e.point, { layers: ['clusters'] }).length) {
        propsRef.current.onSelect(null);
      }
    });
    for (const layer of ['clusters', 'report-points']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }

    // Keep the canvas sized to its container (e.g. when switching back from the list view).
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      loadedRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Data, selection, user location.
  useEffect(() => {
    const map = mapRef.current;
    if (map && loadedRef.current) syncData(map, props);
  }, [props.reports, props.selectedId, props.userLocation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus requests (search result, "my location").
  useEffect(() => {
    const map = mapRef.current;
    const focus = props.focus;
    if (!map || !focus) return;
    if (focus.bbox) {
      const [w, s, e, n] = focus.bbox;
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 40, maxZoom: 16 },
      );
    } else if (focus.center) {
      map.flyTo({ center: focus.center, zoom: focus.zoom ?? Math.max(map.getZoom(), 15) });
    }
  }, [props.focus]);

  // MapLibre sets `position: relative` on its container, so the positioning lives on a wrapper.
  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        role="region"
        aria-label={props.label}
        className="size-full"
        data-testid="map"
      />
    </div>
  );
}

function syncData(map: MapLibreMap, props: MapViewProps) {
  (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(toFeatureCollection(props.reports));
  (map.getSource(USER_SOURCE) as GeoJSONSource | undefined)?.setData(
    userFeature(props.userLocation),
  );
  if (map.getLayer('report-selected')) {
    map.setFilter('report-selected', ['==', ['get', 'id'], props.selectedId ?? '']);
  }
}
