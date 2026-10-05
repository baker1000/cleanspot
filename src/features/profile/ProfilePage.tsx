import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { AccountPanel } from '@/features/auth/AccountPanel';
import { DemoAccounts } from '@/features/demo/DemoAccounts';
import { useAuth } from '@/features/auth/useAuth';
import { LegalLinks } from '@/features/legal/LegalLinks';
import { StaffPickupLink } from '@/features/pickups/PickupsPage';
import { useOutbox } from '@/features/report/outbox/OutboxProvider';
import { saveExport, type DataExport } from './api';
import { useProfileApi } from './ProfileApiContext';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-slate-200 pt-4">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ProfilePage({
  download = saveExport,
}: {
  /** Inject for tests. */
  download?: (file: DataExport) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const api = useProfileApi();
  // Kept here: after deleting, the session (and with it the sections below) is gone.
  const [deleted, setDeleted] = useState(false);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('profile.title')}</h1>
      {deleted && <Alert tone="success">{t('profile.delete.done')}</Alert>}
      <DemoAccounts />
      <AccountPanel />
      <StaffPickupLink />
      {api && session && (
        <>
          <VolunteerSection />
          <ExportSection download={download} />
          <DeleteSection onDeleted={() => setDeleted(true)} />
        </>
      )}
      <nav aria-label={t('legal.nav')} className="border-t border-slate-200 pt-4">
        <LegalLinks />
      </nav>
    </div>
  );
}

function VolunteerSection() {
  const { t } = useTranslation();
  const api = useProfileApi()!;
  const { session, isRegistered } = useAuth();
  const userId = isRegistered ? (session?.user.id ?? null) : null;
  const [volunteer, setVolunteer] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ released: number } | 'error' | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    api
      .isVolunteer(userId)
      .then((v) => active && setVolunteer(v))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, userId]);

  if (!volunteer && !(result && result !== 'error')) return null;

  async function leave() {
    setBusy(true);
    try {
      const released = await api.leaveVolunteerRole();
      setResult({ released });
      setVolunteer(false);
    } catch {
      setResult('error');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Section title={t('profile.volunteer.title')}>
      {result && result !== 'error' ? (
        <Alert tone="success">
          {t('profile.volunteer.left')}{' '}
          {result.released > 0 && t('profile.volunteer.released', { count: result.released })}
        </Alert>
      ) : (
        <>
          <p className="text-slate-700">{t('profile.volunteer.intro')}</p>
          {result === 'error' && <Alert tone="error">{t('profile.error')}</Alert>}
          {confirming ? (
            <div className="flex flex-col gap-3 rounded-lg border border-slate-300 p-3">
              <p>{t('profile.volunteer.confirm')}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" loading={busy} onClick={() => void leave()}>
                  {t('profile.volunteer.confirmButton')}
                </Button>
                <Button variant="secondary" onClick={() => setConfirming(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" className="self-start" onClick={() => setConfirming(true)}>
              {t('profile.volunteer.leave')}
            </Button>
          )}
        </>
      )}
    </Section>
  );
}

function ExportSection({ download }: { download: (file: DataExport) => void | Promise<void> }) {
  const { t } = useTranslation();
  const api = useProfileApi()!;
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function run() {
    setState('busy');
    try {
      await download(await api.exportData());
      setState('done');
    } catch {
      setState('error');
    }
  }

  return (
    <Section title={t('profile.export.title')}>
      <p className="text-slate-700">{t('profile.export.intro')}</p>
      {state === 'done' && <Alert tone="success">{t('profile.export.done')}</Alert>}
      {state === 'error' && <Alert tone="error">{t('profile.error')}</Alert>}
      <Button
        variant="secondary"
        className="self-start"
        loading={state === 'busy'}
        onClick={() => void run()}
      >
        {t('profile.export.button')}
      </Button>
    </Section>
  );
}

function DeleteSection({ onDeleted }: { onDeleted: () => void }) {
  const { t } = useTranslation();
  const api = useProfileApi()!;
  const { isAnonymous, signOut } = useAuth();
  const outbox = useOutbox();
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const checkId = useId();
  const variant = isAnonymous ? 'anonymous' : 'account';
  const queued = outbox.entries.length;

  async function run() {
    setBusy(true);
    setError(false);
    try {
      await api.deleteAccount();
    } catch {
      setError(true);
      setBusy(false);
      return;
    }
    // Unsent reports would otherwise be sent again under a new anonymous identity.
    await Promise.all(outbox.entries.map((e) => outbox.discard(e.id).catch(() => {})));
    onDeleted();
    await signOut({ local: true });
  }

  return (
    <Section title={t(`profile.delete.title.${variant}`)}>
      <p className="text-slate-700">{t('profile.delete.intro')}</p>
      <ul className="list-disc ps-6 text-slate-700">
        <li>{t('profile.delete.whatPhotos')}</li>
        <li>{t('profile.delete.whatReports')}</li>
        <li>{t('profile.delete.whatClaims')}</li>
        {queued > 0 && <li>{t('profile.delete.whatQueued', { count: queued })}</li>}
      </ul>
      {error && <Alert tone="error">{t('profile.error')}</Alert>}
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-lg border border-red-700 p-3">
          <div className="flex items-start gap-3">
            <input
              id={checkId}
              type="checkbox"
              className="mt-1 size-6 shrink-0"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            <label htmlFor={checkId}>{t('profile.delete.understood')}</label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={!understood}
              loading={busy}
              onClick={() => void run()}
            >
              {t(`profile.delete.confirmButton.${variant}`)}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setUnderstood(false);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setConfirming(true)}>
          {t(`profile.delete.button.${variant}`)}
        </Button>
      )}
    </Section>
  );
}
