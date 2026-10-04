import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { changeLanguage, i18next, initI18n } from '@/i18n';

// jsdom has no WebGL: every test gets the fake map (src/test/fakeMapView.tsx).
vi.mock('@/features/map/MapView', () => import('./fakeMapView'));

if (typeof document !== 'undefined') {
  // jsdom has no object URLs (photo previews).
  URL.createObjectURL ??= () => 'blob:fake';
  URL.revokeObjectURL ??= () => {};

  await initI18n('de');

  afterEach(async () => {
    cleanup();
    localStorage.clear();
    if (i18next.language !== 'de') await changeLanguage('de', { persist: false });
  });
}
