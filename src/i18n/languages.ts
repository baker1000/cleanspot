export const LANGUAGES = [
  { code: 'de', name: 'Deutsch', dir: 'ltr' },
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
  { code: 'tr', name: 'Türkçe', dir: 'ltr' },
  { code: 'uk', name: 'Українська', dir: 'ltr' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];
export type Dir = 'ltr' | 'rtl';

export const DEFAULT_LANG: Lang = 'de';
export const STORAGE_KEY = 'cleanspot.lang';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && LANGUAGES.some((l) => l.code === value);
}

export function dirFor(lang: Lang): Dir {
  return LANGUAGES.find((l) => l.code === lang)?.dir ?? 'ltr';
}

/**
 * Picks the UI language: stored choice > first supported browser language > German.
 * Region subtags are ignored ("ar-EG" -> "ar").
 */
export function detectLanguage(stored: string | null, browserLanguages: readonly string[]): Lang {
  if (isLang(stored)) return stored;
  for (const tag of browserLanguages) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}
