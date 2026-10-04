import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { getGeocoder, type Geocoder } from '@/features/geocoding';
import { CATEGORIES, type ReportCategory, type ReportSize } from '@/features/map/reports';
import { uuid } from '@/lib/uuid';
import {
  HAZARD_TYPES,
  MAX_COMMENT,
  SIZES,
  type HazardType,
  type NearbyReport,
  type TenantInfo,
} from './api';
import { LocationPicker, type PickedLocation } from './LocationPicker';
import { useOutbox } from './outbox/OutboxProvider';
import type { OutboxError } from './outbox/store';
import { PhotoPicker, type PickedPhoto } from './PhotoPicker';
import type { PreparedPhoto } from './photo';
import { useReportSubmitApi } from './ReportSubmitApiContext';

type Missing = 'photos' | 'location' | 'category' | 'size';
type SubmitState =
  | { kind: 'editing' }
  | { kind: 'submitting' }
  | { kind: 'error'; reason: OutboxError }
  | { kind: 'done'; reportId: string }
  /** Saved on the device (offline queue); sent automatically later. */
  | { kind: 'queued'; reason: OutboxError };

export interface ReportPageProps {
  geocoder?: Geocoder | null;
  /** Test seams for the browser-only parts. */
  preparePhoto?: (file: Blob) => Promise<PreparedPhoto>;
  locate?: Parameters<typeof LocationPicker>[0]['locate'];
}

export function ReportPage({ geocoder = getGeocoder(), preparePhoto, locate }: ReportPageProps) {
  const { t } = useTranslation();
  const api = useReportSubmitApi();
  const outbox = useOutbox();
  const ids = { photos: useId(), location: useId(), category: useId(), size: useId() };
  const commentId = useId();
  const summaryRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  // Generated once per draft so a retry after an error never creates a second report.
  const [clientId, setClientId] = useState(uuid);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [hazardType, setHazardType] = useState<HazardType | null>(null);
  const [size, setSize] = useState<ReportSize | null>(null);
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState<Missing[]>([]);
  const [state, setState] = useState<SubmitState>({ kind: 'editing' });
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [nearby, setNearby] = useState<NearbyReport[]>([]);

  // Who receives the report, and open reports close by (duplicate warning).
  useEffect(() => {
    if (!api || !location) return;
    const controller = new AbortController();
    void api.tenantAt(location.lng, location.lat, controller.signal).then((info) => {
      if (!controller.signal.aborted) setTenant(info);
    });
    void api.nearby(location.lng, location.lat, controller.signal).then((rows) => {
      if (!controller.signal.aborted) setNearby(rows);
    });
    return () => controller.abort();
  }, [api, location]);

  useEffect(() => {
    if (state.kind === 'done' || state.kind === 'queued') doneRef.current?.focus();
  }, [state.kind]);

  const currentMissing = (): Missing[] =>
    [
      photos.length === 0 && 'photos',
      !location && 'location',
      !category && 'category',
      !size && 'size',
    ].filter((m): m is Missing => Boolean(m));

  // Clear a field's error as soon as it is filled in.
  const shownMissing = missing.filter((m) => currentMissing().includes(m));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!api || state.kind === 'submitting') return;
    const gaps = currentMissing();
    setMissing(gaps);
    if (gaps.length) {
      // Wait for the summary to render, then move focus to it (WCAG 3.3.1).
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setState({ kind: 'submitting' });
    // Without connection the outbox keeps the report on the device and sends it later.
    const outcome = await outbox.send({
      clientId,
      lng: location!.lng,
      lat: location!.lat,
      accuracyM: location!.accuracy,
      category: category!,
      hazardType: category === 'hazardous' ? (hazardType ?? 'other') : null,
      size: size!,
      comment,
      photos: photos.map(({ id, blob, ext }) => ({ id, blob, ext })),
      takenAt: new Date().toISOString(),
    });
    setState(
      outcome.kind === 'sent'
        ? { kind: 'done', reportId: outcome.reportId }
        : outcome.kind === 'queued'
          ? { kind: 'queued', reason: outcome.reason }
          : { kind: 'error', reason: outcome.reason },
    );
  }

  function startOver() {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setClientId(uuid());
    setPhotos([]);
    setLocation(null);
    setCategory(null);
    setHazardType(null);
    setSize(null);
    setComment('');
    setMissing([]);
    setTenant(null);
    setNearby([]);
    setState({ kind: 'editing' });
  }

  if (state.kind === 'done' || state.kind === 'queued') {
    const queued = state.kind === 'queued';
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 ref={doneRef} tabIndex={-1} className="text-2xl font-bold focus:outline-none">
          {t(queued ? 'report.queued.title' : 'report.done.title')}
        </h1>
        {queued ? (
          <Alert tone="info">
            <p>{t(`report.queued.reason.${queuedReason(state.reason)}`)}</p>
            <p>{t('report.queued.body')}</p>
          </Alert>
        ) : (
          <Alert tone="success">{t('report.done.body')}</Alert>
        )}
        <div className="flex flex-wrap gap-2">
          {!queued && (
            <Link
              to={`/app/reports/${state.reportId}`}
              className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white hover:bg-brand-900"
            >
              {t('report.done.view')}
            </Link>
          )}
          <Link
            to="/app"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-400 bg-white px-4 py-2 font-semibold text-slate-900 hover:bg-slate-100"
          >
            {t('report.done.map')}
          </Link>
          <Button variant="ghost" onClick={startOver}>
            {t('report.done.another')}
          </Button>
        </div>
      </div>
    );
  }

  const fieldError = (m: Missing) =>
    shownMissing.includes(m) ? t(`report.missing.${m}`) : undefined;
  const hazardous = category === 'hazardous';

  return (
    <form noValidate onSubmit={submit} className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('report.title')}</h1>
        <p className="text-slate-700">{t('report.intro')}</p>
      </div>

      {!api && <Alert tone="warning">{t('errors.backendNotConfigured')}</Alert>}

      {shownMissing.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} className="focus:outline-none">
          <Alert tone="error">
            <p className="font-semibold">{t('report.missing.summary')}</p>
            <ul className="ms-5 list-disc">
              {shownMissing.map((m) => (
                <li key={m}>
                  <a href={`#${ids[m]}`} className="underline" onClick={(e) => jumpTo(e, ids[m])}>
                    {t(`report.missing.${m}`)}
                  </a>
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <PhotoPicker
        id={ids.photos}
        photos={photos}
        onChange={setPhotos}
        error={fieldError('photos')}
        prepare={preparePhoto}
      />

      <LocationPicker
        id={ids.location}
        value={location}
        onChange={setLocation}
        error={fieldError('location')}
        geocoder={geocoder}
        locate={locate}
      />

      {nearby.length > 0 && (
        <Alert tone="info">
          <p className="font-semibold">{t('report.nearby.title', { count: nearby.length })}</p>
          <p>{t('report.nearby.body')}</p>
          <ul className="ms-5 list-disc">
            {nearby.slice(0, 3).map((r) => (
              <li key={r.id}>
                <Link to={`/app/reports/${r.id}`} className="underline">
                  {t('report.nearby.item', {
                    category: t(`enums.category.${r.category}`),
                    meters: Math.round(r.distanceM),
                  })}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <ChoiceGroup<ReportCategory>
        id={ids.category}
        name="category"
        legend={t('report.category.legend')}
        error={fieldError('category')}
        choices={CATEGORIES.map((c) => ({ value: c, label: t(`enums.category.${c}`) }))}
        value={category}
        onChange={setCategory}
      />

      {hazardous && (
        <div className="flex flex-col gap-3">
          <Alert tone="warning">
            <p className="font-semibold">{t('report.hazard.warning')}</p>
            <p>{t('report.hazard.emergency')}</p>
          </Alert>
          <AuthorityHint tenant={tenant} hasLocation={location !== null} />
          <ChoiceGroup<HazardType>
            name="hazard"
            legend={t('report.hazard.legend')}
            hint={t('report.hazard.hint')}
            choices={HAZARD_TYPES.map((h) => ({ value: h, label: t(`enums.hazard.${h}`) }))}
            value={hazardType}
            onChange={setHazardType}
          />
        </div>
      )}

      {category === 'bulky' && tenant?.bulkyWasteUrl && (
        <Alert tone="info">
          {t('report.bulky.text', { name: tenant.name })}{' '}
          <a href={tenant.bulkyWasteUrl} target="_blank" rel="noreferrer" className="underline">
            {t('report.bulky.link')}
          </a>
        </Alert>
      )}

      <ChoiceGroup<ReportSize>
        id={ids.size}
        name="size"
        legend={t('report.size.legend')}
        error={fieldError('size')}
        choices={SIZES.map((s) => ({
          value: s,
          label: t(`enums.size.${s}`),
          description: t(`report.size.hints.${s}`),
        }))}
        value={size}
        onChange={setSize}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={commentId} className="text-lg font-semibold">
          {t('report.comment.label')}
        </label>
        <p id={`${commentId}-hint`} className="text-sm text-slate-700">
          {t('report.comment.hint')}
        </p>
        <textarea
          id={commentId}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={MAX_COMMENT}
          rows={3}
          aria-describedby={`${commentId}-hint ${commentId}-count`}
          className="rounded-lg border border-slate-500 bg-white px-3 py-2 text-base text-slate-900"
        />
        <p id={`${commentId}-count`} className="text-end text-sm text-slate-700">
          {t('report.comment.counter', { used: comment.length, max: MAX_COMMENT })}
        </p>
      </div>

      <p className="text-sm text-slate-700">{t('report.privacy')}</p>

      {state.kind === 'error' && <Alert tone="error">{t(`report.errors.${state.reason}`)}</Alert>}

      <Button type="submit" block loading={state.kind === 'submitting'} disabled={!api}>
        {state.kind === 'submitting' ? t('report.submitting') : t('report.submit')}
      </Button>
    </form>
  );
}

/** Why a report was queued instead of sent, as the reporter needs to know it. */
function queuedReason(reason: OutboxError): 'offline' | 'rate_limited' | 'server' {
  if (reason === 'rate_limited' || reason === 'server') return reason;
  return 'offline';
}

/** Moves focus into the field group (the browser only scrolls for in-page links). */
function jumpTo(e: MouseEvent, id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  target.focus();
  target.scrollIntoView?.({ block: 'start' });
}

/** Hazardous waste: who to contact. Outside every municipality: the local authority. */
function AuthorityHint({
  tenant,
  hasLocation,
}: {
  tenant: TenantInfo | null;
  hasLocation: boolean;
}) {
  const { t } = useTranslation();
  if (!hasLocation) return null;
  const text =
    tenant?.kind === 'municipality'
      ? t('report.hazard.authorityMunicipality', { name: tenant.name })
      : tenant?.kind === 'public'
        ? t('report.hazard.authorityPublic')
        : t('report.hazard.authorityUnknown');
  return <Alert tone="info">{text}</Alert>;
}
