// The few places where the native app (Capacitor: Android, later iOS) differs from the browser.
// Plugins are imported lazily, so the web build never loads them.
import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();

/** Thrown when the camera cannot be used (e.g. permission denied); cancelling is not an error. */
export class CameraUnavailable extends Error {
  constructor(cause?: unknown) {
    super('Camera unavailable', { cause });
    this.name = 'CameraUnavailable';
  }
}

const cancelled = (error: unknown) => /cancel/i.test(error instanceof Error ? error.message : '');

/**
 * Opens the system camera (never the gallery) and returns the photo, or null if the user cancels.
 * The file is re-encoded by preparePhoto afterwards like any other photo (metadata removed).
 */
export async function takeNativePhoto(): Promise<Blob | null> {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  let webPath: string | undefined;
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      quality: 90,
      correctOrientation: true,
      saveToGallery: false,
    });
    webPath = photo.webPath;
  } catch (error) {
    if (cancelled(error)) return null;
    throw new CameraUnavailable(error);
  }
  if (!webPath) throw new CameraUnavailable();
  return (await fetch(webPath)).blob();
}

/** Native position lookup; asks for the location permission first. */
export async function nativePosition(): Promise<
  { ok: true; lng: number; lat: number; accuracy: number } | { ok: false; denied: boolean }
> {
  const { Geolocation } = await import('@capacitor/geolocation');
  try {
    let status = await Geolocation.checkPermissions();
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      status = await Geolocation.requestPermissions({
        permissions: ['location', 'coarseLocation'],
      });
    }
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      return { ok: false, denied: true };
    }
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 60_000,
    });
    return {
      ok: true,
      lng: pos.coords.longitude,
      lat: pos.coords.latitude,
      accuracy: pos.coords.accuracy,
    };
  } catch {
    // Location switched off, no fix in time, …
    return { ok: false, denied: false };
  }
}

/** Saves a text file through the system share sheet (Files, Drive, e-mail, …). */
export async function shareTextFile(fileName: string, text: string, title: string) {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  // App cache: not backed up, cleared by the system when space is needed.
  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  try {
    await Share.share({ title, files: [uri] });
  } catch (error) {
    if (!cancelled(error)) throw error;
  }
}

/** Native start-up: hide the splash screen, Android back button follows the app's history. */
export async function initNativeShell() {
  if (!isNative()) return;
  const [{ SplashScreen }, { App }] = await Promise.all([
    import('@capacitor/splash-screen'),
    import('@capacitor/app'),
  ]);
  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
  await SplashScreen.hide();
}
