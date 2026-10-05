// Simple pages; each moves to its feature module when it grows.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

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
