// One-shot position lookup. The browser API today; the Capacitor Geolocation plugin can be
// plugged in here for the native app (step 11) without touching the screens.

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

export function locateOnce(): Promise<Position> {
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
