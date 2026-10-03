import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { changeLanguage, i18next, initI18n } from '@/i18n';

if (typeof document !== 'undefined') {
  await initI18n('de');

  afterEach(async () => {
    cleanup();
    localStorage.clear();
    if (i18next.language !== 'de') await changeLanguage('de', { persist: false });
  });
}
