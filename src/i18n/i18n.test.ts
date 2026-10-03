import { changeLanguage, detectLanguage, dirFor, i18next, LANGUAGES, STORAGE_KEY } from '@/i18n';

const locales = import.meta.glob<Record<string, unknown>>('./locales/*.json', {
  eager: true,
  import: 'default',
});

/** Flattens nested JSON to "a.b.c" -> value. */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  return Object.entries(obj).reduce<Record<string, unknown>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(acc, flatten(v as Record<string, unknown>, key));
    else acc[key] = v;
    return acc;
  }, {});
}

const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

describe('detectLanguage', () => {
  it('prefers the stored choice', () => {
    expect(detectLanguage('tr', ['en-US'])).toBe('tr');
  });
  it('falls back to the first supported browser language, ignoring regions', () => {
    expect(detectLanguage(null, ['pl-PL', 'ar-EG', 'en'])).toBe('ar');
    expect(detectLanguage('xx', ['UK-ua'])).toBe('uk');
  });
  it('defaults to German', () => {
    expect(detectLanguage(null, ['pl', 'es'])).toBe('de');
  });
  it('knows that only Arabic is right-to-left', () => {
    expect(LANGUAGES.filter((l) => dirFor(l.code) === 'rtl').map((l) => l.code)).toEqual(['ar']);
  });
});

describe('translation files', () => {
  const de = flatten(locales['./locales/de.json']!);
  const deKeys = Object.keys(de).sort();

  it('exist for every supported language', () => {
    for (const { code } of LANGUAGES) expect(locales[`./locales/${code}.json`]).toBeDefined();
  });

  it.each(LANGUAGES.map((l) => l.code))('%s has exactly the German keys, none empty', (code) => {
    const flat = flatten(locales[`./locales/${code}.json`]!);
    expect(Object.keys(flat).sort()).toEqual(deKeys);
    for (const [key, value] of Object.entries(flat)) {
      expect(typeof value, key).toBe('string');
      expect((value as string).trim(), key).not.toBe('');
      expect(placeholders(value as string), key).toEqual(placeholders(de[key] as string));
    }
  });
});

describe('changeLanguage', () => {
  it('loads the bundle, sets lang/dir on <html> and remembers the choice', async () => {
    await changeLanguage('ar');
    expect(i18next.t('nav.map')).toBe('الخريطة');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('ar');

    await changeLanguage('fr');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
