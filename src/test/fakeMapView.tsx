// Stand-in for the MapLibre MapView in unit tests (jsdom has no WebGL). Registered globally in
// setup.ts. Renders reports as buttons and lets tests drive viewport changes.
import { useEffect, useLayoutEffect } from 'react';
import type { MapViewProps, Viewport } from '@/features/map/MapView';

export const fakeMap: { props: MapViewProps | null; emitViewport(v: Viewport): void } = {
  props: null,
  emitViewport(v) {
    fakeMap.props?.onViewportChange(v);
  },
};

export function viewportAround([lng, lat]: [number, number], zoom = 13): Viewport {
  return { bbox: [lng - 0.05, lat - 0.05, lng + 0.05, lat + 0.05], center: [lng, lat], zoom };
}

export default function FakeMapView(props: MapViewProps) {
  useLayoutEffect(() => {
    fakeMap.props = props;
  });
  useEffect(() => {
    fakeMap.props?.onViewportChange(
      viewportAround(props.initialView.center, props.initialView.zoom),
    );
    return () => {
      fakeMap.props = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div role="region" aria-label={props.label} data-testid="map">
      {props.reports.map((r) => (
        <button key={r.id} type="button" onClick={() => props.onSelect(r.id)}>
          {`marker ${r.id}`}
        </button>
      ))}
      {props.focus && <output data-testid="map-focus">{JSON.stringify(props.focus)}</output>}
      {props.userLocation && <output data-testid="map-user">here</output>}
    </div>
  );
}
