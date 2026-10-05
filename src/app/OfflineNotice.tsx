import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

const subscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

export const useOnline = () =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

/** Tells what still works without a connection. */
export function OfflineNotice() {
  const { t } = useTranslation();
  if (useOnline()) return null;
  return (
    <p role="status" className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
      {t('pwa.offline')}
    </p>
  );
}
