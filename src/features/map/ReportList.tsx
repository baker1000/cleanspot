import { useTranslation } from 'react-i18next';
import { StatusDot } from './MapFiltersPanel';
import { formatDate } from './ReportSheet';
import { distanceMeters, type MapReport } from './reports';

export function formatDistance(metres: number, language: string) {
  const nf = (max: number) => new Intl.NumberFormat(language, { maximumFractionDigits: max });
  return metres < 1000
    ? `${nf(0).format(Math.round(metres / 10) * 10)} m`
    : `${nf(1).format(metres / 1000)} km`;
}

/**
 * Text alternative to the map: every report in the current view, nearest to the map centre
 * first. Works with keyboard and screen readers, and without WebGL.
 */
export function ReportList({
  reports,
  center,
  selectedId,
  onSelect,
}: {
  reports: MapReport[];
  center: [number, number] | null;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const { t, i18n } = useTranslation();
  const origin = center ? { lng: center[0], lat: center[1] } : null;
  const rows = reports
    .map((r) => ({ report: r, distance: origin ? distanceMeters(origin, r) : 0 }))
    .sort((a, b) => a.distance - b.distance);

  if (rows.length === 0) {
    return <p className="p-4 text-slate-800">{t('map.list.empty')}</p>;
  }

  return (
    <ul aria-label={t('map.list.label')} className="divide-y divide-slate-200">
      {rows.map(({ report, distance }) => (
        <li key={report.id}>
          <button
            type="button"
            onClick={() => onSelect(report.id)}
            aria-current={report.id === selectedId || undefined}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start hover:bg-slate-100 aria-[current=true]:bg-brand-50"
          >
            <StatusDot status={report.status} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">
                {t(`enums.category.${report.category}`)}
                {report.isHazardous && (
                  <span className="ms-2 rounded bg-red-700 px-1.5 py-0.5 text-xs font-bold text-white">
                    {t('map.list.hazardBadge')}
                  </span>
                )}
              </span>
              <span className="text-sm text-slate-700">
                {t(`enums.status.${report.status}`)} · {formatDate(report.createdAt, i18n.language)}
              </span>
            </span>
            {origin && (
              <span className="shrink-0 text-sm text-slate-700">
                {formatDistance(distance, i18n.language)}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
