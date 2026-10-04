import { lazy, Suspense } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import type { MapViewProps } from './MapView';

const MapView = lazy(() => import('./MapView'));

export function LazyMapView(props: MapViewProps & { loadingLabel: string }) {
  const { loadingLabel, ...rest } = props;
  return (
    <Suspense
      fallback={
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
          <Spinner label={loadingLabel} />
        </div>
      }
    >
      <MapView {...rest} />
    </Suspense>
  );
}
