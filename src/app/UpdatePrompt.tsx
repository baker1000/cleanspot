import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { dismissUpdate, usePwaState } from './pwa';

/** "A new version is available": the user decides when to reload (e.g. not mid-report). */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const { applyUpdate } = usePwaState();
  const [busy, setBusy] = useState(false);
  if (!applyUpdate) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-2 bottom-[calc(4.5rem+var(--safe-bottom))] z-50 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white p-3 shadow-lg"
    >
      <p className="font-semibold">{t('pwa.updateAvailable')}</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={dismissUpdate}>
          {t('pwa.later')}
        </Button>
        <Button
          loading={busy}
          onClick={() => {
            setBusy(true);
            void applyUpdate();
          }}
        >
          {t('pwa.reload')}
        </Button>
      </div>
    </div>
  );
}
