/**
 * The legal texts in ./content are TEMPLATES. Fill in every [[placeholder]], have them reviewed
 * by a lawyer (or the municipality's legal department and data protection officer), then set
 * this to true to remove the "must be reviewed" notice from the pages.
 */
export const LEGAL_TEXTS_REVIEWED = false;

export type LegalDoc = 'imprint' | 'privacy' | 'terms';

/** German paths are canonical (the privacy URL for Google Play is /datenschutz). */
export const LEGAL_PATHS: Record<LegalDoc, string> = {
  imprint: '/impressum',
  privacy: '/datenschutz',
  terms: '/nutzungsbedingungen',
};

/** English aliases, same pages. */
export const LEGAL_ALIASES: Record<LegalDoc, string> = {
  imprint: '/imprint',
  privacy: '/privacy',
  terms: '/terms',
};
