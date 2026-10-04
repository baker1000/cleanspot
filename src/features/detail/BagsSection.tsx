import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import type { PreparedPhoto } from '@/features/report/photo';
import type { Position } from '@/lib/geolocation';
import type { BagsAction } from './actions';
import type { BagsInput, ReportDetail } from './api';
import { PhotoLocationForm } from './PhotoLocationForm';

/**
 * After a cleanup: "X bags placed here" with a photo where the bags are. Creates a pickup task
 * for the municipality's staff. Bags already reported for this report are listed (RLS: own).
 */
export function BagsSection({
  report,
  action,
  busy,
  cancelling,
  onSubmit,
  onCancel,
  prepare,
  locate,
}: {
  report: ReportDetail;
  action: BagsAction;
  busy: boolean;
  /** Id of the task being withdrawn. */
  cancelling: string | null;
  onSubmit(input: Omit<BagsInput, 'reportId'>): void;
  onCancel(taskId: string): void;
  prepare?: (file: Blob) => Promise<PreparedPhoto>;
  locate?: () => Promise<Position>;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const countId = useId();
  const [count, setCount] = useState('1');
  const bags = Number(count);
  const validCount = Number.isInteger(bags) && bags >= 1 && bags <= report.maxBags;

  if (action === 'hidden') return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {t('reportDetail.bags.section')}
      </h2>

      {action === 'no_service' ? (
        <Alert tone="info">{t('reportDetail.bags.noService')}</Alert>
      ) : (
        <>
          <p className="text-slate-700">{t('reportDetail.bags.intro')}</p>
          {/* Remount after each report, so the next drop starts with an empty form. */}
          <PhotoLocationForm
            key={report.pickups.length}
            texts="reportDetail.bags"
            target={report}
            radiusM={report.bagRadiusM}
            busy={busy}
            canSubmit={validCount}
            prepare={prepare}
            locate={locate}
            onSubmit={(input) => onSubmit({ ...input, bagCount: bags })}
          >
            <div className="flex flex-col gap-1">
              <label htmlFor={countId} className="font-semibold">
                {t('reportDetail.bags.count')}
              </label>
              <input
                id={countId}
                type="number"
                inputMode="numeric"
                min={1}
                max={report.maxBags}
                step={1}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                aria-describedby={`${countId}-hint`}
                aria-invalid={!validCount || undefined}
                className="min-h-11 w-28 rounded-lg border border-slate-500 bg-white px-3 py-2 text-base text-slate-900"
              />
              <p id={`${countId}-hint`} className="text-sm text-slate-700">
                {t('reportDetail.bags.countHint', { max: report.maxBags })}
              </p>
            </div>
          </PhotoLocationForm>
        </>
      )}

      {report.pickups.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('reportDetail.bags.reported')}</h3>
          <ul className="flex flex-col gap-2">
            {report.pickups.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {t('reportDetail.bags.item', {
                    count: p.bagCount,
                    status: t(`reportDetail.bags.status.${p.status}`),
                  })}
                </span>
                {p.status === 'open' && (
                  <Button
                    variant="secondary"
                    loading={cancelling === p.id}
                    onClick={() => onCancel(p.id)}
                    aria-label={t('reportDetail.bags.cancelLabel', { count: p.bagCount })}
                  >
                    {t('reportDetail.bags.cancel')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
