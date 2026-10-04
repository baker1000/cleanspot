import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CloseIcon } from '@/components/icons';
import { StatusDot } from './MapFiltersPanel';
import type { MapReport } from './reports';

export function formatDate(iso: string, language: string) {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(iso));
}

/**
 * Non-modal bottom sheet with a short preview of the selected report. Focus moves to its heading
 * when it opens; Escape or the close button closes it.
 */
export function ReportSheet({ report, onClose }: { report: MapReport; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Return focus to where it was (map canvas or list item) when the sheet closes.
    const previous = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [report.id]);

  // Escape closes the sheet while focus is inside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sectionRef.current?.contains(document.activeElement)) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className="pointer-events-auto mx-auto w-full max-w-xl rounded-t-2xl border border-slate-300 bg-white p-4 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-2">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-bold focus:outline-none"
        >
          {t(`enums.category.${report.category}`)}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-800 hover:bg-slate-100"
        >
          <CloseIcon />
        </button>
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-slate-700">{t('map.sheet.status')}</dt>
        <dd className="flex items-center gap-2 font-medium">
          <StatusDot status={report.status} />
          {t(`enums.status.${report.status}`)}
        </dd>
        <dt className="text-slate-700">{t('map.sheet.size')}</dt>
        <dd className="font-medium">{t(`enums.size.${report.size}`)}</dd>
        <dt className="text-slate-700">{t('map.sheet.reportedOn')}</dt>
        <dd className="font-medium">{formatDate(report.createdAt, i18n.language)}</dd>
        <dt className="text-slate-700">{t('map.sheet.confirmationsLabel')}</dt>
        <dd className="font-medium">
          {t('map.sheet.confirmations', { count: report.confirmationCount })}
        </dd>
      </dl>

      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {report.isHazardous && (
          <li className="rounded border-s-4 border-red-700 bg-red-50 px-2 py-1 font-semibold text-red-950">
            {t('map.sheet.hazardWarning')}
          </li>
        )}
        {report.isClaimed && report.status !== 'cleared' && (
          <li className="text-slate-800">{t('map.sheet.claimed')}</li>
        )}
        {report.reportedByMe && <li className="text-slate-800">{t('map.sheet.reportedByMe')}</li>}
      </ul>

      <Link
        to={`/app/reports/${report.id}`}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white hover:bg-brand-900"
      >
        {t('map.sheet.details')}
      </Link>
    </section>
  );
}
