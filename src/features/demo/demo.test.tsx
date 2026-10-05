import { screen, within } from '@testing-library/react';
import { renderApp } from '@/test/render';
import { fakeAuthClient } from '@/test/fakeAuth';
import { DEMO_ACCOUNTS } from './DemoContext';

const demo = { password: 'demo-pass' };

describe('demo mode', () => {
  it('is invisible when off (the normal build)', async () => {
    renderApp({ route: '/app/profile', authClient: fakeAuthClient() });
    await screen.findByText(/Sie sind nicht angemeldet/);
    expect(screen.queryByRole('heading', { name: 'Demo-Konten' })).toBeNull();
    expect(screen.queryByText(/sind erfunden/)).toBeNull();
  });

  it('every app page says the data is invented and links to the role switcher', async () => {
    renderApp({ route: '/app/report', authClient: fakeAuthClient(), demo });
    expect(await screen.findByText(/Alle Meldungen und Personen hier sind erfunden/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Demo-Rolle wechseln' })).toHaveAttribute(
      'href',
      '/app/profile',
    );
  });

  it('signs in as a role with one tap and shows which role is active', async () => {
    const client = fakeAuthClient();
    const { user } = renderApp({ route: '/app/profile', authClient: client, demo });
    const section = await screen.findByRole('region', { name: 'Demo-Konten' });
    expect(within(section).getAllByRole('button')).toHaveLength(6);

    await user.click(within(section).getByRole('button', { name: 'Anmelden als Freiwillige/r' }));
    expect(client.signInWithPassword).toHaveBeenCalledWith({
      email: 'volunteer@demo.cleanspot.invalid',
      password: 'demo-pass',
    });
    expect(
      await within(section).findByText('Sie sind angemeldet als: Freiwillige/r (Demo)'),
    ).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Angemeldet' })).toBeDisabled();

    // Switching goes straight to the next role, without signing out first.
    await user.click(
      within(section).getByRole('button', { name: 'Anmelden als Mitarbeiter/in der Kommune' }),
    );
    expect(client.signInWithPassword).toHaveBeenLastCalledWith({
      email: 'staff@demo.cleanspot.invalid',
      password: 'demo-pass',
    });
  });

  it('explains a missing demo account instead of "wrong password"', async () => {
    const client = fakeAuthClient();
    client.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { code: 'invalid_credentials', status: 400 },
    } as never);
    const { user } = renderApp({ route: '/app/profile', authClient: client, demo });
    await user.click(await screen.findByRole('button', { name: 'Anmelden als Super-Admin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Dieses Demo-Konto ist auf dem Server nicht eingerichtet.',
    );
  });

  it('has one account per role of the specification', () => {
    expect(DEMO_ACCOUNTS.map((a) => a.role)).toEqual([
      'citizen',
      'volunteer',
      'organizer',
      'municipality_staff',
      'municipality_admin',
      'super_admin',
    ]);
  });
});
