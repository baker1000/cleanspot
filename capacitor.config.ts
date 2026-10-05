import type { CapacitorConfig } from '@capacitor/cli';

// Native app (Android primary, iOS prepared). The web build in dist/ is bundled into the app;
// `npm run android:sync` rebuilds and copies it.
const config: CapacitorConfig = {
  appId: 'store.thinktools.cleanspot',
  appName: 'CleanSpot',
  webDir: 'dist',
  // Identifies the app to the tile and geocoding servers (Nominatim usage policy).
  appendUserAgent: 'CleanSpot-App',
  plugins: {
    SplashScreen: {
      // Hidden by the app once the first screen has rendered (src/lib/native.ts).
      launchAutoHide: false,
      backgroundColor: '#15803d',
      showSpinner: false,
    },
  },
};

export default config;
