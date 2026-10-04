import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/features/auth/useAuth';
import { navigationLinks } from '@/features/detail/actions';
import { classifyActionError, type ActionError } from '@/features/detail/api';
import { LocateFailure, locateOnce, type Position } from '@/lib/geolocation';
import type { PickupStop, StaffTenant } from './api';
import { usePickupsApi } from './PickupsApiContext';
import { planRoute, routeUrl } from './route';

type Load<T> = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; value: T };
type Start =
  | { kind: 'none' }
  | { kind: 'locating' }
  | { kind: 'set'; position: Position }
  | { kind: 'failed'; reason: 'denied' | 'unavailable' };

const linkButton =
  'inline-flex min-h-11 items-center rounded-lg border border-slate-400 bg-white px-4 py-2 font-semibold text-slate-900 hover:bg-slate-100';

/** Staff: today's open bag pickups of their municipality, ordered into a short route. */
export function PickupsPage({ locate = locateOnce }: { locate?: () => Promise<Position> }) {
  const { t, i18n } = useTranslation();
  const api = usePickupsApi();
  const { status, session, isRegistered } = useAuth();
  const userId = isRegistered ? (session?.user.id ?? null) : null;
  const [tenants, setTenants] = useState<Load<StaffTenant[]>>({ kind: 'loading' });
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Load<PickupStop[]>>({ kind: 'loading' });
  const [start, setStart] = useState<Start>({ kind: 'none' });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<'collected' | 'cancelled' | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const tenantSelectId = useId();

  useEffect(() => {
    if (!api || !userId) return;
    let active = true;
    api
      .staffTenants(userId)
      .then((list) => active && setTenants({ kind: 'ready', value: list }))
      .catch(() => active && setTenants({ kind: 'error' }));
    return () => {
      active = false;
    };
  }, [api, userId]);

  const currentTenant =
    tenants.kind === 'ready' ? (tenantId ?? tenants.value[0]?.id ?? null) : null;

  const loadTasks = useCallback(async () => {
    if (!api || !currentTenant) return;
    try {
      setTasks({ kind: 'ready', value: await api.openTasks(currentTenant) });
    } catch {
      setTasks({ kind: 'error' });
    }
  }, [api, currentTenant]);
  useEffect(() => {
    void loadTasks(); // eslint-disable-line react-hooks/set-state-in-effect -- sets state after awaiting
  }, [loadTasks]);

  const startPoint = start.kind === 'set' ? start.position : null;
  const plan = useMemo(
    () => (tasks.kind === 'ready' ? planRoute(tasks.value, startPoint) : null),
    [tasks, startPoint],
  );

  if (!api) return <Alert tone="warning">{t('errors.backendNotConfigured')}</Alert>;
  if (status === 'loading') return <Spinner label={t('common.loading')} />;

  const km = (metres: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'unit',
      unit: 'kilometer',
      maximumFractionDigits: 1,
    }).format(metres / 1000);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));

  async function startFromHere() {
    setStart({ kind: 'locating' });
    try {
      setStart({ kind: 'set', position: await locate() });
    } catch (err) {
      setStart({
        kind: 'failed',
        reason: err instanceof LocateFailure ? err.reason : 'unavailable',
      });
    }
  }

  async function act(stop: PickupStop, kind: 'collected' | 'cancelled') {
    setBusy(stop.id);
    setError(null);
    setNotice(null);
    try {
      await (kind === 'collected' ? api!.collect(stop.id) : api!.cancel(stop.id));
      setNotice(kind);
      setTasks((s) =>
        s.kind === 'ready' ? { kind: 'ready', value: s.value.filter((x) => x.id !== stop.id) } : s,
      );
    } catch (err) {
      const e = classifyActionError(err);
      setError(e);
      // Someone else handled it already: show the current list.
      if (e.reason === 'status') await loadTasks();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('pickups.title')}</h1>
        <p className="text-slate-700">{t('pickups.intro')}</p>
      </div>

      {!userId ? (
        <p>
          {t('pickups.needsAccount')}{' '}
          <Link to="/app/profile" className="font-semibold text-brand-900 underline">
            {t('reportDetail.actions.toAccount')}
          </Link>
        </p>
      ) : tenants.kind === 'loading' ? (
        <Spinner label={t('common.loading')} />
      ) : tenants.kind === 'error' ? (
        <Alert tone="error">{t('pickups.loadError')}</Alert>
      ) : tenants.value.length === 0 ? (
        <Alert tone="info">{t('pickups.staffOnly')}</Alert>
      ) : (
        <>
          {tenants.value.length > 1 && (
            <div className="flex flex-col gap-1">
              <label htmlFor={tenantSelectId} className="font-semibold">
                {t('pickups.tenant')}
              </label>
              <select
                id={tenantSelectId}
                value={currentTenant ?? ''}
                onChange={(e) => {
                  setTenantId(e.target.value);
                  setTasks({ kind: 'loading' });
                }}
                className="min-h-11 w-fit rounded-lg border border-slate-500 bg-white px-3 py-2"
              >
                {tenants.value.map((tn) => (
                  <option key={tn.id} value={tn.id}>
                    {tn.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {notice && <Alert tone="success">{t(`pickups.notices.${notice}`)}</Alert>}
          {error && <Alert tone="error">{t(`reportDetail.errors.${error.reason}`)}</Alert>}

          {tasks.kind === 'loading' ? (
            <Spinner label={t('common.loading')} />
          ) : tasks.kind === 'error' ? (
            <div className="flex flex-col gap-2">
              <Alert tone="error">{t('pickups.loadError')}</Alert>
              <Button variant="secondary" className="w-fit" onClick={() => void loadTasks()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : plan && plan.stops.length === 0 ? (
            <Alert tone="info">{t('pickups.empty')}</Alert>
          ) : (
            plan && (
              <>
                <section className="flex flex-col gap-3">
                  <p className="font-semibold">
                    {t('pickups.summary', {
                      stops: plan.stops.length,
                      bags: plan.stops.reduce((n, s) => n + s.bagCount, 0),
                      kg: Math.round(plan.stops.reduce((n, s) => n + (s.estimatedKg ?? 0), 0)),
                      distance: km(plan.totalM),
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {start.kind === 'set' ? (
                      <Button variant="secondary" onClick={() => setStart({ kind: 'none' })}>
                        {t('pickups.clearStart')}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        loading={start.kind === 'locating'}
                        onClick={() => void startFromHere()}
                      >
                        {t('pickups.startHere')}
                      </Button>
                    )}
                    <a
                      href={routeUrl(startPoint ? [startPoint, ...plan.stops] : plan.stops)}
                      target="_blank"
                      rel="noreferrer"
                      className={linkButton}
                    >
                      {t('pickups.openRoute')}
                    </a>
                  </div>
                  {start.kind === 'set' && <p>{t('pickups.startSet')}</p>}
                  {start.kind === 'failed' && (
                    <Alert tone="error">{t(`reportDetail.cleanup.location.${start.reason}`)}</Alert>
                  )}
                  <p className="text-sm text-slate-700">{t('pickups.routeHint')}</p>
                </section>

                <ol className="flex flex-col gap-4">
                  {plan.stops.map((stop, i) => {
                    const number = i + 1;
                    const links = navigationLinks(stop);
                    const leg = plan.legs[i]!;
                    return (
                      <li
                        key={stop.id}
                        className="flex flex-col gap-2 rounded-lg border border-slate-300 p-3"
                      >
                        <h2 className="text-lg font-semibold">
                          {t('pickups.stop', {
                            number,
                            category: t(`enums.category.${stop.category}`),
                          })}
                        </h2>
                        <p>
                          {t('pickups.bags', {
                            count: stop.bagCount,
                            kg: Math.round(stop.estimatedKg ?? 0),
                          })}
                        </p>
                        {(i > 0 || startPoint) && (
                          <p className="text-slate-700">
                            {t(i === 0 ? 'pickups.legFromStart' : 'pickups.leg', {
                              distance: km(leg),
                            })}
                          </p>
                        )}
                        <p className="text-sm text-slate-700">
                          {t('pickups.reportedOn', { date: date(stop.createdAt) })}
                        </p>
                        {stop.photoUrl && (
                          <img
                            src={stop.photoUrl}
                            alt={t('pickups.photoAlt', { number })}
                            loading="lazy"
                            className="max-h-48 w-full max-w-xs rounded-lg border border-slate-300 object-cover"
                          />
                        )}
                        <div className="flex flex-wrap gap-2">
                          <a href={links.app} className={linkButton}>
                            {t('reportDetail.location.app')}
                          </a>
                          <a
                            href={links.web}
                            target="_blank"
                            rel="noreferrer"
                            className={linkButton}
                          >
                            {t('reportDetail.location.route')}
                          </a>
                          <Link to={`/app/reports/${stop.reportId}`} className={linkButton}>
                            {t('pickups.report')}
                          </Link>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            loading={busy === stop.id}
                            onClick={() => void act(stop, 'collected')}
                            aria-label={t('pickups.collectedLabel', { number })}
                          >
                            {t('pickups.collected')}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy === stop.id}
                            onClick={() => void act(stop, 'cancelled')}
                            aria-label={t('pickups.notThereLabel', { number })}
                          >
                            {t('pickups.notThere')}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}

/** On the profile page: a link to the pickup route for municipality staff. */
export function StaffPickupLink() {
  const { t } = useTranslation();
  const api = usePickupsApi();
  const { session, isRegistered } = useAuth();
  const userId = isRegistered ? (session?.user.id ?? null) : null;
  const [isStaff, setIsStaff] = useState(false);
  useEffect(() => {
    if (!api || !userId) return;
    let active = true;
    api
      .staffTenants(userId)
      .then((list) => active && setIsStaff(list.length > 0))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, userId]);
  if (!userId || !isStaff) return null;
  return (
    <Link to="/app/pickups" className={`${linkButton} w-fit`}>
      {t('pickups.profileLink')}
    </Link>
  );
}
