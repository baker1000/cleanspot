// Simple pages; each moves to its feature module when it grows (profile: step 9).
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LanguageSelect } from '@/components/LanguageSelect';
import { AccountPanel } from '@/features/auth/AccountPanel';

export function ProfilePage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('profile.title')}</h1>
      <AccountPanel />
    </div>
  );
}

export function LandingPage() {
  const { t } = useTranslation();
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 p-6 text-center"
    >
      <LanguageSelect />
      <h1 className="text-3xl font-bold text-brand-900">{t('app.name')}</h1>
      <p className="text-xl font-semibold">{t('landing.title')}</p>
      <p className="text-slate-700">{t('landing.intro')}</p>
      <Link
        to="/app"
        className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-6 py-2 font-semibold text-white hover:bg-brand-900"
      >
        {t('landing.openApp')}
      </Link>
    </main>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 p-6"
    >
      <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
      <Link to="/" className="font-semibold text-brand-900 underline">
        {t('notFound.back')}
      </Link>
    </main>
  );
}
