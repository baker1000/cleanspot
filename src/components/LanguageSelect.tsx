import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage, isLang, LANGUAGES } from '@/i18n';

export function LanguageSelect({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const id = useId();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {t('language.label')}
      </label>
      <select
        id={id}
        value={i18n.language}
        onChange={(e) => {
          if (isLang(e.target.value)) void changeLanguage(e.target.value);
        }}
        className="min-h-11 rounded-lg border border-slate-500 bg-white px-2 text-slate-900"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
