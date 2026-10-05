import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { announceUpdate } from '@/app/pwa';
import { initI18n } from '@/i18n';
import { initNativeShell, isNative } from '@/lib/native';
import '@/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

void initI18n().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  void initNativeShell();
});

// Service worker: offline app, map cache, Background Sync (src/sw/sw.ts). Web builds only: the
// native app ships its files inside the app and sends the offline queue while it is open.
if (import.meta.env.PROD && !isNative() && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh: () => announceUpdate(() => updateSW(true)),
      onRegisteredSW(_url, registration) {
        // Long-running installed apps look for a new version once an hour.
        if (registration)
          setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000);
      },
    });
  });
}
