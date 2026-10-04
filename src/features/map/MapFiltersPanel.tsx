import { useTranslation } from 'react-i18next';
import {
  CATEGORIES,
  MAP_STATUSES,
  STATUS_COLORS,
  type MapFilters,
  type ReportCategory,
  type ReportStatus,
} from './reports';

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Status legend dot; the hazardous ring is shown separately. */
export function StatusDot({ status }: { status: ReportStatus }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 rounded-full border-2 border-white shadow"
      style={{ backgroundColor: STATUS_COLORS[status] }}
    />
  );
}

export function MapFiltersPanel({
  id,
  filters,
  onChange,
}: {
  id: string;
  filters: MapFilters;
  onChange(filters: MapFilters): void;
}) {
  const { t } = useTranslation();
  const checkbox = 'size-5 accent-brand-700';
  const row = 'flex min-h-11 items-center gap-3';

  return (
    <div
      id={id}
      className="flex flex-col gap-4 rounded-lg border border-slate-300 bg-white p-4 shadow-md"
    >
      <fieldset>
        <legend className="mb-1 font-semibold">{t('map.filters.status')}</legend>
        {MAP_STATUSES.map((status) => (
          <label key={status} className={row}>
            <input
              type="checkbox"
              className={checkbox}
              checked={filters.statuses.includes(status)}
              onChange={() =>
                onChange({ ...filters, statuses: toggle<ReportStatus>(filters.statuses, status) })
              }
            />
            <StatusDot status={status} />
            {t(`enums.status.${status}`)}
          </label>
        ))}
        <p className="mt-1 flex items-center gap-3 text-sm text-slate-700">
          <span
            aria-hidden="true"
            className="inline-block size-4 shrink-0 rounded-full border-4 border-slate-900 bg-slate-400"
          />
          {t('map.filters.hazardLegend')}
        </p>
      </fieldset>

      <fieldset>
        <legend className="mb-1 font-semibold">{t('map.filters.category')}</legend>
        {CATEGORIES.map((category) => (
          <label key={category} className={row}>
            <input
              type="checkbox"
              className={checkbox}
              checked={filters.categories.includes(category)}
              onChange={() =>
                onChange({
                  ...filters,
                  categories: toggle<ReportCategory>(filters.categories, category),
                })
              }
            />
            {t(`enums.category.${category}`)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
