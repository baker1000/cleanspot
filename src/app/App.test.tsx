import { screen, within } from '@testing-library/react';
import { renderApp } from '@/test/render';

describe('routing and shell', () => {
  it('renders the landing page with a link into the app', async () => {
    const { user } = renderApp({ route: '/' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Weniger Müll in unserer Landschaft' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'App öffnen' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Karte' })).toBeInTheDocument();
  });

  it('marks the current page in the main navigation', async () => {
    const { user } = renderApp({ route: '/app' });
    const nav = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    expect(within(nav).getByRole('link', { name: 'Karte' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await user.click(within(nav).getByRole('link', { name: 'Profil' }));
    expect(within(nav).getByRole('link', { name: 'Profil' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Karte' })).not.toHaveAttribute('aria-current');
  });

  it('has a skip link to the main content', () => {
    renderApp({ route: '/app' });
    expect(screen.getByRole('link', { name: 'Zum Inhalt springen' })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(document.getElementById('main')).toBeInTheDocument();
  });

  it('warns when the backend is not configured', () => {
    renderApp({ route: '/app', authClient: null });
    expect(screen.getByRole('alert')).toHaveTextContent('Der Server ist nicht eingerichtet');
  });

  it('switches to Arabic with right-to-left layout', async () => {
    const { user } = renderApp({ route: '/app' });
    await user.selectOptions(screen.getByLabelText('Sprache'), 'ar');
    expect(await screen.findByRole('heading', { level: 1, name: 'الخريطة' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
  });

  it('shows a not-found page for unknown routes', () => {
    renderApp({ route: '/does-not-exist' });
    expect(screen.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeInTheDocument();
  });
});
