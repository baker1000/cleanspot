// One-shot position lookup: the browser API, or the Capacitor Geolocation plugin in the native
// app (which also asks for the system permission).
import { isNative, nativePosition } from './native';

export interface Position {
  lng: number;
  lat: number;
  /** Radius in metres. */
  accuracy: number;
}

export type LocateError = 'denied' | 'unavailable';

export class LocateFailure extends Error {
  constructor(public readonly reason: LocateError) {
    super(`Location unavailable: ${reason}`);
    this.name = 'LocateFailure';
  }
}

export async function locateOnce(): Promise<Position> {
  if (isNative()) {
    const result = await nativePosition();
    if (!result.ok) throw new LocateFailure(result.denied ? 'denied' : 'unavailable');
    return { lng: result.lng, lat: result.lat, accuracy: result.accuracy };
  }
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocateFailure('unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) =>
        reject(new LocateFailure(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}
