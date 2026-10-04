import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useOutbox } from './OutboxProvider';
import type { OutboxError } from './store';

/** What is waiting on this device, what failed, and what was sent in the background. */
export function OutboxStatus() {
  const { t, i18n } = useTranslation();
  const { entries, syncing, sentInBackground, syncNow, discard, dismissSent } = useOutbox();
  const pending = entries.filter((e) => e.state === 'pending');
  const failed = entries.filter((e) => e.state === 'failed');
  if (!pending.length && !failed.length && !sentInBackground) return null;

  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    <div className="flex flex-col gap-2">
      {pending.length > 0 && (
        <Alert tone="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">{t('outbox.pending', { count: pending.length })}</p>
              <p>{t('outbox.pendingHint')}</p>
            </div>
            <Button variant="secondary" onClick={syncNow} loading={syncing}>
              {syncing ? t('outbox.sending') : t('outbox.sendNow')}
            </Button>
          </div>
        </Alert>
      )}

      {failed.length > 0 && (
        <Alert tone="warning">
          <p className="font-semibold">{t('outbox.failed', { count: failed.length })}</p>
          <ul className="mt-1 flex flex-col gap-2">
            {failed.map((entry) => {
              const date = dateFormat.format(entry.createdAt);
              return (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {t('outbox.failedItem', {
                      category: t(`enums.category.${entry.draft.category}`),
                      date,
                    })}{' '}
                    {t(`outbox.reasons.${failedReason(entry.lastError)}`)}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => void discard(entry.id)}
                    aria-label={t('outbox.discardLabel', { date })}
                  >
                    {t('outbox.discard')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Alert>
      )}

      {sentInBackground > 0 && (
        <Alert tone="success">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>{t('outbox.sent', { count: sentInBackground })}</p>
            <Button variant="ghost" onClick={dismissSent}>
              {t('outbox.dismiss')}
            </Button>
          </div>
        </Alert>
      )}
    </div>
  );
}

function failedReason(reason: OutboxError | null): 'invalid' | 'blocked' | 'photo' {
  return reason === 'blocked' || reason === 'photo' ? reason : 'invalid';
}
