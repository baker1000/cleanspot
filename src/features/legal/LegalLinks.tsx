import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LEGAL_PATHS, type LegalDoc } from './config';

const DOCS: LegalDoc[] = ['imprint', 'privacy', 'terms'];

/** Impressum · Datenschutz · Nutzungsbedingungen (wrap in a <nav> with a label). */
export function LegalLinks() {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {DOCS.map((doc) => (
        <li key={doc}>
          <Link
            to={LEGAL_PATHS[doc]}
            className="inline-flex min-h-11 items-center text-slate-700 underline hover:text-brand-900"
          >
            {t(`legal.${doc}`)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
