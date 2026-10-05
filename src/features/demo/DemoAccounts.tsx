import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useMatch } from 'react-router';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import type { AuthErrorKey } from '@/features/auth/authErrors';
import { useAuth } from '@/features/auth/useAuth';
import { DEMO_ACCOUNTS, demoRoleOf, useDemo, type DemoRole } from './DemoContext';

/** Profile page in demo mode: sign in as any demo role with one tap. */
export function DemoAccounts() {
  const { t } = useTranslation();
  const demo = useDemo();
  const auth = useAuth();
  const headingId = useId();
  const [busy, setBusy] = useState<DemoRole | null>(null);
  const [error, setError] = useState<AuthErrorKey | null>(null);
  if (!demo || auth.status !== 'ready') return null;
  const current = auth.isRegistered ? demoRoleOf(auth.session?.user.email) : null;

  async function signInAs(role: DemoRole, email: string) {
    setError(null);
    setBusy(role);
    const result = await auth.signIn(email, demo!.password);
    setBusy(null);
    if (!result.ok) setError(result.error);
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-sky-700 bg-sky-50 p-4"
    >
      <h2 id={headingId} className="text-xl font-semibold">
        {t('demo.accounts.title')}
      </h2>
      <p>{t('demo.accounts.intro')}</p>
      {current && (
        <Alert tone="success">
          {t('demo.accounts.current', { role: t(`demo.roles.${current}.name`) })}
        </Alert>
      )}
      {error && (
        <Alert tone="error">
          {error === 'invalidCredentials'
            ? t('demo.accounts.unavailable')
            : t(`auth.errors.${error}`)}
        </Alert>
      )}
      <ul className="flex flex-col gap-3">
        {DEMO_ACCOUNTS.map(({ role, email }) => (
          <li key={role} className="flex flex-col gap-2 rounded-lg bg-white p-3">
            <h3 className="font-semibold">{t(`demo.roles.${role}.name`)}</h3>
            <p className="text-slate-700">{t(`demo.roles.${role}.try`)}</p>
            <Button
              variant="secondary"
              className="self-start"
              loading={busy === role}
              disabled={busy !== null || current === role}
              onClick={() => void signInAs(role, email)}
            >
              {current === role
                ? t('demo.accounts.active')
                : t('demo.accounts.signInAs', { role: t(`demo.roles.${role}.name`) })}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every app page in demo mode: the data is invented; where to switch roles. */
export function DemoNotice() {
  const { t } = useTranslation();
  const demo = useDemo();
  const onProfile = useMatch('/app/profile') !== null;
  if (!demo) return null;
  return (
    <Alert tone="info">
      {t('demo.notice')}{' '}
      {!onProfile && (
        <Link to="/app/profile" className="font-semibold underline">
          {t('demo.switchRole')}
        </Link>
      )}
    </Alert>
  );
}
