import { act, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { fakeAuthClient, fakeSession } from '@/test/fakeAuth';
import { renderApp, renderWithProviders } from '@/test/render';
import { mapAuthError } from './authErrors';
import { useAuth } from './useAuth';
import type { AuthContextValue } from './AuthProvider';

describe('mapAuthError', () => {
  it.each([
    [{ code: 'invalid_credentials' }, 'invalidCredentials'],
    [{ code: 'weak_password' }, 'weakPassword'],
    [{ code: 'user_already_exists' }, 'emailTaken'],
    [{ code: 'email_exists' }, 'emailTaken'],
    [{ status: 429 }, 'rateLimited'],
    [{ name: 'AuthRetryableFetchError' }, 'network'],
    [{ code: 'something_new' }, 'unknown'],
    [null, 'unknown'],
  ])('%o -> %s', (error, key) => {
    expect(mapAuthError(error)).toBe(key);
  });
});

describe('AccountPanel', () => {
  const fillAndSubmit = async (
    user: ReturnType<typeof renderApp>['user'],
    email: string,
    password: string,
    submit: string,
  ) => {
    await user.type(screen.getByLabelText('E-Mail-Adresse'), email);
    await user.type(screen.getByLabelText('Passwort'), password);
    await user.click(screen.getByRole('button', { name: submit }));
  };

  it('signs in and then shows the account with a sign-out button', async () => {
    const client = fakeAuthClient();
    const { user } = renderApp({ route: '/app/profile', authClient: client });
    await screen.findByText(/Sie sind nicht angemeldet/);
    await fillAndSubmit(user, 'anna@example.org', 'geheim123', 'Anmelden');
    expect(client.signInWithPassword).toHaveBeenCalledWith({
      email: 'anna@example.org',
      password: 'geheim123',
    });
    expect(await screen.findByText('Angemeldet als anna@example.org')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abmelden' }));
    expect(await screen.findByText(/Sie sind nicht angemeldet/)).toBeInTheDocument();
  });

  it('shows a translated, announced error for wrong credentials', async () => {
    const client = fakeAuthClient();
    client.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { code: 'invalid_credentials', status: 400 },
    } as never);
    const { user } = renderApp({ route: '/app/profile', authClient: client });
    await screen.findByText(/Sie sind nicht angemeldet/);
    await fillAndSubmit(user, 'anna@example.org', 'falsch', 'Anmelden');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-Mail-Adresse oder Passwort ist falsch.',
    );
  });

  it('rejects short passwords on sign-up before calling the server', async () => {
    const client = fakeAuthClient();
    const { user } = renderApp({ route: '/app/profile', authClient: client });
    await user.click(await screen.findByRole('button', { name: /Jetzt registrieren/ }));
    await fillAndSubmit(user, 'neu@example.org', 'kurz', 'Konto erstellen');
    expect(await screen.findByRole('alert')).toHaveTextContent('mindestens 8 Zeichen');
    expect(client.signUp).not.toHaveBeenCalled();
  });

  it('new sign-up asks to confirm the email when no session is returned', async () => {
    const client = fakeAuthClient();
    const { user } = renderApp({ route: '/app/profile', authClient: client });
    await user.click(await screen.findByRole('button', { name: /Jetzt registrieren/ }));
    await fillAndSubmit(user, 'neu@example.org', 'langesPasswort', 'Konto erstellen');
    expect(client.signUp).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'bestätigen Sie Ihre E-Mail-Adresse',
    );
  });

  it('upgrades an anonymous session in place instead of creating a new user', async () => {
    const client = fakeAuthClient(fakeSession({ anonymous: true }));
    const { user } = renderApp({ route: '/app/profile', authClient: client });
    expect(await screen.findByText(/ohne Konto/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Jetzt registrieren/ }));
    await fillAndSubmit(user, 'neu@example.org', 'langesPasswort', 'Konto erstellen');
    expect(client.updateUser).toHaveBeenCalledWith({
      email: 'neu@example.org',
      password: 'langesPasswort',
    });
    expect(client.signUp).not.toHaveBeenCalled();
  });
});

describe('ensureSession', () => {
  it('does not create a session on page load, and creates one anonymous session on demand', async () => {
    const client = fakeAuthClient();
    let auth: AuthContextValue | undefined;
    function Probe() {
      const value = useAuth();
      useEffect(() => {
        auth = value;
      });
      return null;
    }
    renderWithProviders(<Probe />, { authClient: client });
    await waitFor(() => expect(auth?.status).toBe('ready'));
    expect(auth!.session).toBeNull();
    expect(client.signInAnonymously).not.toHaveBeenCalled();

    let first: unknown;
    await act(async () => {
      first = await auth!.ensureSession();
    });
    let second: unknown;
    await act(async () => {
      second = await auth!.ensureSession();
    });
    expect(client.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(auth!.isAnonymous).toBe(true);
    expect(auth!.isRegistered).toBe(false);
  });
});
