import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { changeLanguage } from '@/i18n';
import { renderApp } from '@/test/render';
import { loadLegalText } from './LegalPage';
import { Markdown, parseBlocks } from './Markdown';

describe('Markdown subset', () => {
  it('parses headings, paragraphs with line breaks and lists', () => {
    expect(parseBlocks('# T\n\nline 1\nline 2\n\n- a\n  more\n- b\n## S')).toEqual([
      { kind: 'heading', level: 1, text: 'T' },
      { kind: 'paragraph', lines: ['line 1', 'line 2'] },
      { kind: 'list', items: ['a more', 'b'] },
      { kind: 'heading', level: 2, text: 'S' },
    ]);
  });

  it('renders bold, placeholders and safe links only; never raw HTML', () => {
    const { container } = render(
      <MemoryRouter>
        <Markdown
          source={
            '**fett** [[Name]] [intern](/datenschutz) [extern](https://osm.org) [böse](javascript:alert(1)) <img src=x onerror=alert(1)>'
          }
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('strong')).toHaveTextContent('fett');
    expect(container.querySelector('mark')).toHaveTextContent('[Name]');
    expect(screen.getByRole('link', { name: 'intern' })).toHaveAttribute('href', '/datenschutz');
    expect(screen.getByRole('link', { name: 'extern' })).toHaveAttribute('href', 'https://osm.org');
    expect(screen.queryByRole('link', { name: 'böse' })).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });
});

describe('legal texts', () => {
  it.each(['imprint', 'privacy', 'terms'] as const)(
    '%s exists in German and English',
    async (doc) => {
      for (const lang of ['de', 'en'] as const) {
        const text = await loadLegalText(doc, lang);
        expect(text).toMatch(/^# /);
      }
    },
  );
});

describe('LegalPage', () => {
  it('shows the German privacy policy with the template warning', async () => {
    renderApp({ route: '/datenschutz' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Datenschutzerklärung' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('juristisch geprüft');
    expect(screen.getByRole('navigation', { name: 'Rechtliches' })).toBeInTheDocument();
  });

  it('English alias in English, with the "German is binding" note', async () => {
    await changeLanguage('en', { persist: false });
    renderApp({ route: '/privacy' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Only the German version is legally binding.')).toBeInTheDocument();
  });

  it('other languages get the English text and say so', async () => {
    await changeLanguage('ar', { persist: false });
    renderApp({ route: '/impressum' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Imprint' })).toBeInTheDocument();
    expect(screen.getByText(/متوفر بالألمانية والإنجليزية فقط/)).toBeInTheDocument();
  });

  it('the landing page links to all three', () => {
    renderApp({ route: '/' });
    for (const [name, href] of [
      ['Impressum', '/impressum'],
      ['Datenschutz', '/datenschutz'],
      ['Nutzungsbedingungen', '/nutzungsbedingungen'],
    ])
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  });
});
