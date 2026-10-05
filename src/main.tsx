import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { announceUpdate } from '@/app/pwa';
import { initI18n } from '@/i18n';
import '@/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

void initI18n().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

// Service worker: offline app, map cache, Background Sync (src/sw/sw.ts). Builds only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
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
