// Public landing page: what CleanSpot is, live statistics, install / Google Play, legal links.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { promptInstall, usePwaState } from '@/app/pwa';
import { LanguageSelect } from '@/components/LanguageSelect';
import { Button } from '@/components/ui/Button';
import { LegalLinks } from '@/features/legal/LegalLinks';
import { useLandingConfig } from './LandingContext';
import type { PublicStats } from './stats';

const STEPS = ['report', 'clear', 'collect'] as const;

export function LandingPage() {
  const { t } = useTranslation();
  const { playStoreUrl } = useLandingConfig();
  const { installPrompt } = usePwaState();

  return (
    <div className="min-h-dvh bg-white">
      <header className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 pt-[calc(0.75rem+var(--safe-top))] pb-3">
        <span className="flex items-center gap-2 text-lg font-bold text-brand-900">
          <img src="/icons/icon.svg" alt="" width={32} height={32} />
          {t('app.name')}
        </span>
        <LanguageSelect />
      </header>

      <main id="main" className="mx-auto flex max-w-4xl flex-col gap-12 px-4 pt-6 pb-12">
        <section
          aria-labelledby="landing-title"
          className="flex flex-col items-center gap-5 text-center"
        >
          <h1 id="landing-title" className="text-3xl font-bold text-brand-900 sm:text-4xl">
            {t('landing.title')}
          </h1>
          <p className="max-w-2xl text-lg text-slate-700">{t('landing.intro')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              to="/app"
              className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-6 py-2 font-semibold text-white hover:bg-brand-900"
            >
              {t('landing.openApp')}
            </Link>
            {installPrompt && (
              <Button variant="secondary" onClick={() => void promptInstall()}>
                {t('landing.install')}
              </Button>
            )}
            {playStoreUrl && (
              <a
                href={playStoreUrl}
                rel="noopener"
                className="inline-flex min-h-11 items-center rounded-lg border border-slate-900 bg-slate-900 px-6 py-2 font-semibold text-white hover:bg-slate-700"
              >
                {t('landing.playStore')}
              </a>
            )}
          </div>
          {!playStoreUrl && <p className="text-sm text-slate-700">{t('landing.playStoreSoon')}</p>}
        </section>

        <StatsSection />

        <section aria-labelledby="landing-how">
          <h2 id="landing-how" className="mb-4 text-2xl font-bold">
            {t('landing.how.title')}
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step} className="rounded-xl border border-slate-200 p-4">
                <h3 className="mb-1 font-semibold">
                  <span aria-hidden="true" className="me-2 text-brand-700">
                    {i + 1}.
                  </span>
                  {t(`landing.how.${step}.title`)}
                </h3>
                <p className="text-slate-700">{t(`landing.how.${step}.text`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="landing-municipalities" className="rounded-xl bg-brand-50 p-5">
          <h2 id="landing-municipalities" className="mb-2 text-2xl font-bold">
            {t('landing.municipalities.title')}
          </h2>
          <p className="text-slate-800">{t('landing.municipalities.text')}</p>
        </section>

        <p className="text-slate-700">{t('landing.principles')}</p>
      </main>

      <footer className="mx-auto max-w-4xl border-t border-slate-200 px-4 py-4">
        <nav aria-label={t('legal.nav')}>
          <LegalLinks />
        </nav>
      </footer>
    </div>
  );
}

type StatsState = { kind: 'loading' } | { kind: 'ready'; stats: PublicStats } | { kind: 'error' };

function StatsSection() {
  const { t, i18n } = useTranslation();
  const { stats: api } = useLandingConfig();
  const [state, setState] = useState<StatsState>({ kind: 'loading' });

  useEffect(() => {
    if (!api) return;
    const abort = new AbortController();
    api.load(abort.signal).then(
      (stats) => setState({ kind: 'ready', stats }),
      () => !abort.signal.aborted && setState({ kind: 'error' }),
    );
    return () => abort.abort();
  }, [api]);

  if (!api) return null;
  const format = new Intl.NumberFormat(i18n.language).format;
  const items: [string, keyof PublicStats][] = [
    ['reports', 'reports'],
    ['cleared', 'cleared'],
    ['clearedLast30Days', 'clearedLast30Days'],
    ['kgCleared', 'kgCleared'],
    ['open', 'open'],
    ['municipalities', 'municipalities'],
  ];

  return (
    <section aria-labelledby="landing-stats" aria-busy={state.kind === 'loading'}>
      <h2 id="landing-stats" className="mb-4 text-2xl font-bold">
        {t('landing.stats.title')}
      </h2>
      {state.kind === 'loading' && <p className="text-slate-700">{t('landing.stats.loading')}</p>}
      {state.kind === 'error' && <p className="text-slate-700">{t('landing.stats.unavailable')}</p>}
      {state.kind === 'ready' && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map(([label, key]) => (
            <div
              key={key}
              className="flex flex-col-reverse rounded-xl border border-slate-200 p-4 text-center"
            >
              <dt className="text-sm text-slate-700">
                {t(`landing.stats.${label}`, { count: state.stats[key] })}
              </dt>
              <dd className="text-2xl font-bold text-brand-900">{format(state.stats[key])}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
