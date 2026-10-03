import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './locales/de.json';
import { DEFAULT_LANG, detectLanguage, dirFor, STORAGE_KEY, type Lang } from './languages';

export * from './languages';

// German is bundled (default + fallback); other languages are loaded on demand.
const loaders = import.meta.glob<{ default: Record<string, unknown> }>([
  './locales/*.json',
  '!./locales/de.json',
]);

async function loadResources(lang: Lang) {
  if (lang === DEFAULT_LANG || i18next.hasResourceBundle(lang, 'translation')) return;
  const loader = loaders[`./locales/${lang}.json`];
  if (!loader) throw new Error(`No translations for ${lang}`);
  const mod = await loader();
  i18next.addResourceBundle(lang, 'translation', mod.default, true, true);
}

function applyToDocument(lang: Lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = dirFor(lang);
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private mode / blocked storage: the choice just isn't remembered.
  }
}

export async function initI18n(lang?: Lang) {
  const initial = lang ?? detectLanguage(readStored(), navigator.languages ?? []);
  await i18next.use(initReactI18next).init({
    resources: { de: { translation: de } },
    lng: DEFAULT_LANG,
    fallbackLng: DEFAULT_LANG,
    interpolation: { escapeValue: false }, // React escapes
    returnNull: false,
  });
  await changeLanguage(initial, { persist: false });
  return i18next;
}

export async function changeLanguage(lang: Lang, opts: { persist?: boolean } = {}) {
  await loadResources(lang);
  await i18next.changeLanguage(lang);
  applyToDocument(lang);
  if (opts.persist !== false) store(lang);
}

export { i18next };
