import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LanguageSelect } from '@/components/LanguageSelect';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { LEGAL_TEXTS_REVIEWED, type LegalDoc } from './config';
import { LegalLinks } from './LegalLinks';
import { Markdown } from './Markdown';

// The texts live in ./content/<doc>.<de|en>.md: plain files the operator edits. Loaded on demand.
const TEXTS = import.meta.glob<string>('./content/*.md', { query: '?raw', import: 'default' });
const TEXT_LANGUAGES = ['de', 'en'] as const;

export function loadLegalText(doc: LegalDoc, lang: 'de' | 'en'): Promise<string> {
  const load = TEXTS[`./content/${doc}.${lang}.md`];
  if (!load) return Promise.reject(new Error(`Missing legal text ${doc}.${lang}`));
  return load();
}

/** Impressum, Datenschutzerklärung, Nutzungsbedingungen. German is the binding version. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'de' ? 'de' : 'en';
  const [text, setText] = useState<{ doc: LegalDoc; lang: string; source: string } | 'error'>();

  useEffect(() => {
    let active = true;
    loadLegalText(doc, lang)
      .then((source) => active && setText({ doc, lang, source }))
      .catch(() => active && setText('error'));
    return () => {
      active = false;
    };
  }, [doc, lang]);

  useEffect(() => {
    document.title = `${t(`legal.${doc}`)} · ${t('app.name')}`;
  }, [doc, t]);

  const current = text && text !== 'error' && text.doc === doc && text.lang === lang ? text : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <Link to="/" className="text-lg font-bold text-brand-900">
          {t('app.name')}
        </Link>
        <LanguageSelect />
      </header>
      <main id="main" className="flex flex-col gap-3 leading-relaxed" lang={lang}>
        {!LEGAL_TEXTS_REVIEWED && <Alert tone="warning">{t('legal.templateWarning')}</Alert>}
        {lang !== 'de' && (
          <p className="text-slate-700">
            {!(TEXT_LANGUAGES as readonly string[]).includes(i18n.language) &&
              `${t('legal.onlyGermanEnglish')} `}
            {t('legal.germanBinding')}
          </p>
        )}
        {text === 'error' ? (
          <Alert tone="error">{t('legal.loadError')}</Alert>
        ) : current ? (
          <Markdown source={current.source} />
        ) : (
          <Spinner label={t('common.loading')} />
        )}
      </main>
      <footer className="border-t border-slate-200 pt-4">
        <nav aria-label={t('legal.nav')}>
          <LegalLinks />
        </nav>
      </footer>
    </div>
  );
}
