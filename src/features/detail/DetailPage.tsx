import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/features/auth/useAuth';
import { StatusDot } from '@/features/map/MapFiltersPanel';
import type { PreparedPhoto } from '@/features/report/photo';
import type { Position } from '@/lib/geolocation';
import { availableActions, navigationLinks, type Actions } from './actions';
import type { ActionError } from './api';
import {
  classifyActionError,
  type CleanupInput,
  type DetailEvent,
  type DetailPhoto,
  type ReportDetail,
} from './api';
import { CleanupForm } from './CleanupForm';
import { useDetailApi } from './DetailApiContext';

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'ready'; report: ReportDetail };

type Busy = 'confirm' | 'join' | 'claim' | 'unclaim' | 'cleanup' | null;
type Notice = 'confirmed' | 'joined' | 'claimed' | 'unclaimed' | 'cleared';

const linkButton =
  'inline-flex min-h-11 items-center rounded-lg border border-slate-400 bg-white px-4 py-2 font-semibold text-slate-900 hover:bg-slate-100';

export interface DetailPageProps {
  /** Test seams for the browser-only parts of the after-photo. */
  preparePhoto?: (file: Blob) => Promise<PreparedPhoto>;
  locate?: () => Promise<Position>;
}

export function DetailPage({ preparePhoto, locate }: DetailPageProps) {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const api = useDetailApi();
  const { session, status: authStatus, isRegistered, ensureSession } = useAuth();
  const viewerId = session?.user.id ?? null;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [attempt, setAttempt] = useState(0);

  const fetchReport = useCallback(
    (signal?: AbortSignal) => (api ? api.load(id, viewerId, signal) : Promise.resolve(null)),
    [api, id, viewerId],
  );

  // Wait for the session state, so the viewer's own photos and roles are part of the first load.
  useEffect(() => {
    if (authStatus === 'loading') return;
    const controller = new AbortController();
    fetchReport(controller.signal)
      .then((report) => {
        if (!controller.signal.aborted) {
          setLoad(report ? { kind: 'ready', report } : { kind: 'missing' });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ kind: 'error' });
      });
    return () => controller.abort();
  }, [authStatus, fetchReport, attempt]);

  const reload = async () => {
    try {
      const report = await fetchReport();
      setLoad(report ? { kind: 'ready', report } : { kind: 'missing' });
    } catch {
      // Keep showing the last state; the action result is already announced.
    }
  };

  /** Runs an action as the signed-in user, then shows the new state of the report. */
  async function run(
    kind: Exclude<Busy, null>,
    done: Notice,
    action: (uid: string) => Promise<unknown>,
  ) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const uid = (await ensureSession()).user.id;
      await action(uid);
      setNotice(done);
      await reload();
    } catch (err) {
      const e = classifyActionError(err);
      setError(e);
      // Someone else changed the report in the meantime: show what it looks like now.
      if (e.reason === 'status' || e.reason === 'claimed') await reload();
    } finally {
      setBusy(null);
    }
  }

  if (!api) {
    return (
      <Page>
        <Alert tone="warning">{t('errors.backendNotConfigured')}</Alert>
      </Page>
    );
  }
  if (load.kind === 'loading') {
    return (
      <Page>
        <Spinner label={t('common.loading')} />
      </Page>
    );
  }
  if (load.kind === 'missing' || load.kind === 'error') {
    return (
      <Page>
        <h1 className="text-2xl font-bold">{t('reportDetail.title')}</h1>
        <Alert tone={load.kind === 'error' ? 'error' : 'info'}>
          {t(load.kind === 'error' ? 'reportDetail.loadError' : 'reportDetail.notFound')}
        </Alert>
        {load.kind === 'error' && (
          <Button variant="secondary" className="w-fit" onClick={() => setAttempt((n) => n + 1)}>
            {t('common.retry')}
          </Button>
        )}
      </Page>
    );
  }

  const report = load.report;
  const actions = availableActions(report, isRegistered);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));
  const before = report.photos.filter((p) => p.kind === 'before');
  const after = report.photos.filter((p) => p.kind === 'after');
  const links = navigationLinks(report);

  return (
    <Page>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">
          {t(`enums.category.${report.category}`)}
          {report.hazardType && (
            <span className="block text-lg font-semibold text-slate-800">
              {t(`enums.hazard.${report.hazardType}`)}
            </span>
          )}
        </h1>
        <p className="flex items-center gap-2 font-semibold">
          <StatusDot status={report.status} />
          {t(`enums.status.${report.status}`)}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-slate-800">
          <dt className="font-medium">{t('map.sheet.size')}</dt>
          <dd>{t(`enums.size.${report.size}`)}</dd>
          <dt className="font-medium">{t('map.sheet.reportedOn')}</dt>
          <dd>{date(report.createdAt)}</dd>
          <dt className="font-medium">{t('map.sheet.confirmationsLabel')}</dt>
          <dd>{t('map.sheet.confirmations', { count: report.confirmationCount })}</dd>
          {report.estimatedKg !== null && (
            <>
              <dt className="font-medium">{t('reportDetail.weight')}</dt>
              <dd>{t('reportDetail.weightValue', { kg: report.estimatedKg })}</dd>
            </>
          )}
          {report.tenantName && (
            <>
              <dt className="font-medium">{t('reportDetail.responsible')}</dt>
              <dd>{report.tenantName}</dd>
            </>
          )}
        </dl>
        {report.isHazardous && <Alert tone="warning">{t('report.hazard.warning')}</Alert>}
        {report.reportedByMe && <p className="text-slate-700">{t('map.sheet.reportedByMe')}</p>}
      </div>

      {report.comment && (
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{t('reportDetail.comment')}</h2>
          <p className="whitespace-pre-line">{report.comment}</p>
        </section>
      )}
      {!report.isPublished && <p className="text-slate-700">{t('reportDetail.notPublished')}</p>}

      <Photos
        title={t('reportDetail.photos.before')}
        photos={before}
        altKey="reportDetail.photos.alt"
      />
      {after.length > 0 && (
        <Photos
          title={t('reportDetail.photos.after')}
          photos={after}
          altKey="reportDetail.photos.afterAlt"
        />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('reportDetail.location.title')}</h2>
        <p className="text-slate-800" dir="ltr">
          {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={links.web} target="_blank" rel="noreferrer" className={linkButton}>
            {t('reportDetail.location.route')}
          </a>
          <a href={links.app} className={linkButton}>
            {t('reportDetail.location.app')}
          </a>
        </div>
      </section>

      <ActionPanel
        report={report}
        actions={actions}
        busy={busy}
        date={date}
        onConfirm={() => run('confirm', 'confirmed', () => api.confirm(report.id))}
        onJoin={() =>
          run('join', 'joined', (uid) => api.joinAsVolunteer(uid, report.viewer!.publicTenantId!))
        }
        onClaim={() => run('claim', 'claimed', () => api.claim(report.id))}
        onUnclaim={() => run('unclaim', 'unclaimed', () => api.unclaim(report.id))}
      />

      {actions.cleanup && (
        <CleanupForm
          report={report}
          busy={busy === 'cleanup'}
          prepare={preparePhoto}
          locate={locate}
          onSubmit={(input: Omit<CleanupInput, 'reportId'>) =>
            void run('cleanup', 'cleared', (uid) =>
              api.submitCleanup({ ...input, reportId: report.id }, uid),
            )
          }
        />
      )}

      {notice && <Alert tone="success">{t(`reportDetail.notices.${notice}`)}</Alert>}
      {error && <Alert tone="error">{errorText(t, error)}</Alert>}

      <Timeline events={report.events} />
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Link
        to="/app"
        className="w-fit font-semibold text-brand-900 underline-offset-4 hover:underline"
      >
        {t('reportDetail.back')}
      </Link>
      {children}
    </div>
  );
}

function errorText(t: (key: string, opts?: Record<string, unknown>) => string, error: ActionError) {
  if (error.reason === 'too_far' && error.distance) {
    return t('reportDetail.errors.too_far', {
      meters: Math.round(error.distance.meters),
      max: error.distance.maxMeters,
    });
  }
  return t(`reportDetail.errors.${error.reason === 'too_far' ? 'too_far_unknown' : error.reason}`);
}

function Photos({
  title,
  photos,
  altKey,
}: {
  title: string;
  photos: DetailPhoto[];
  altKey: string;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      {photos.length === 0 ? (
        <p className="text-slate-700">{t('reportDetail.photos.none')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.id} className="flex flex-col gap-1">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer">
                  <img
                    src={p.url}
                    alt={t(altKey, { number: i + 1 })}
                    loading="lazy"
                    className="aspect-square w-full rounded-lg border border-slate-300 object-cover"
                  />
                </a>
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-lg border border-slate-300 bg-slate-100 p-2 text-center text-sm text-slate-700">
                  {t('reportDetail.photos.unavailable')}
                </div>
              )}
              {p.pending && (
                <p className="text-sm text-slate-700">{t('reportDetail.photos.pending')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActionPanel({
  report,
  actions,
  busy,
  date,
  onConfirm,
  onJoin,
  onClaim,
  onUnclaim,
}: {
  report: ReportDetail;
  actions: Actions;
  busy: Busy;
  date(iso: string): string;
  onConfirm(): void;
  onJoin(): void;
  onClaim(): void;
  onUnclaim(): void;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const { confirm, claim } = actions;
  const needsAccount = confirm === 'needs_account' || claim === 'needs_account';

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {t('reportDetail.actions.title')}
      </h2>

      {report.status === 'cleared' && report.clearedAt && (
        <Alert tone="success">
          {t('reportDetail.actions.cleared', { date: date(report.clearedAt) })}
        </Alert>
      )}

      {confirm === 'available' && (
        <div className="flex flex-col gap-1">
          <p className="text-slate-700">{t('reportDetail.actions.confirmHint')}</p>
          <Button
            variant="secondary"
            className="w-fit"
            loading={busy === 'confirm'}
            onClick={onConfirm}
          >
            {t('reportDetail.actions.confirm')}
          </Button>
        </div>
      )}
      {confirm === 'done' && <p>{t('reportDetail.actions.confirmed')}</p>}

      {claim === 'hazardous' && <Alert tone="info">{t('reportDetail.actions.hazardous')}</Alert>}
      {claim === 'join' && (
        <div className="flex flex-col gap-1">
          <p className="text-slate-700">{t('reportDetail.actions.joinHint')}</p>
          <Button className="w-fit" loading={busy === 'join'} onClick={onJoin}>
            {t('reportDetail.actions.join')}
          </Button>
        </div>
      )}
      {claim === 'available' && (
        <div className="flex flex-col gap-1">
          <p className="text-slate-700">{t('reportDetail.actions.claimHint')}</p>
          <Button className="w-fit" loading={busy === 'claim'} onClick={onClaim}>
            {t('reportDetail.actions.claim')}
          </Button>
        </div>
      )}
      {claim === 'mine' && (
        <div className="flex flex-col gap-1">
          <p>{t('reportDetail.actions.mine')}</p>
          <Button
            variant="secondary"
            className="w-fit"
            loading={busy === 'unclaim'}
            onClick={onUnclaim}
          >
            {t('reportDetail.actions.unclaim')}
          </Button>
        </div>
      )}
      {claim === 'taken' && <p>{t('reportDetail.actions.taken')}</p>}

      {needsAccount && (
        <p>
          {t('reportDetail.actions.needsAccount')}{' '}
          <Link to="/app/profile" className="font-semibold text-brand-900 underline">
            {t('reportDetail.actions.toAccount')}
          </Link>
        </p>
      )}
    </section>
  );
}

function Timeline({ events }: { events: DetailEvent[] }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  if (!events.length) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-lg font-semibold">
        {t('reportDetail.timeline.title')}
      </h2>
      <ol className="flex flex-col gap-2 border-s-2 border-slate-300 ps-4">
        {events.map((e) => (
          <li key={e.id}>
            <p className="font-medium">
              {t(`reportDetail.timeline.events.${e.type}`, {
                status: e.toStatus
                  ? t(`enums.status.${e.toStatus}`, { defaultValue: e.toStatus })
                  : '',
              })}
            </p>
            <p className="text-sm text-slate-700">
              <time dateTime={e.createdAt}>{format.format(new Date(e.createdAt))}</time>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
