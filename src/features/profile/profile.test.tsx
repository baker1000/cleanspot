import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { changeLanguage } from '@/i18n';
import type { OutboxEntry } from '@/features/report/outbox/store';
import { createMemoryStore } from '@/features/report/outbox/store';
import { fakeAuthClient, fakeSession } from '@/test/fakeAuth';
import { renderWithProviders } from '@/test/render';
import type { DataExport, ProfileApi } from './api';
import { ProfilePage } from './ProfilePage';

type FakeProfileApi = { [K in keyof ProfileApi]: Mock<ProfileApi[K]> };

function fakeApi(over: Partial<FakeProfileApi> = {}): FakeProfileApi {
  return {
    isVolunteer: vi.fn<ProfileApi['isVolunteer']>(async () => false),
    leaveVolunteerRole: vi.fn<ProfileApi['leaveVolunteerRole']>(async () => 0),
    exportData: vi.fn<ProfileApi['exportData']>(async () => ({ fileName: 'x.json', json: '{}' })),
    deleteAccount: vi.fn<ProfileApi['deleteAccount']>(async () => {}),
    ...over,
  };
}

function setup(
  api: ProfileApi,
  opts: { anonymous?: boolean; queued?: OutboxEntry[]; download?: (f: DataExport) => void } = {},
) {
  const authClient = fakeAuthClient(fakeSession({ anonymous: opts.anonymous }));
  const outboxStore = createMemoryStore(opts.queued ?? []);
  const download = opts.download ?? vi.fn();
  return {
    authClient,
    outboxStore,
    download,
    ...renderWithProviders(
      <Routes>
        <Route path="/app/profile" element={<ProfilePage download={download} />} />
      </Routes>,
      { route: '/app/profile', authClient, profileApi: api, outboxStore },
    ),
  };
}

const queuedEntry = (id: string): OutboxEntry => ({
  id,
  draft: {} as OutboxEntry['draft'],
  state: 'pending',
  attempts: 0,
  lastError: null,
  nextAttemptAt: 0,
  createdAt: 1,
});

describe('ProfilePage – data export', () => {
  it('downloads the export', async () => {
    const api = fakeApi();
    const { user, download } = setup(api);
    await user.click(await screen.findByRole('button', { name: 'Meine Daten herunterladen' }));
    expect(download).toHaveBeenCalledWith({ fileName: 'x.json', json: '{}' });
    expect(await screen.findByText('Die Datei wurde heruntergeladen.')).toBeInTheDocument();
  });

  it('shows an error when the export fails', async () => {
    const api = fakeApi({ exportData: vi.fn(async () => Promise.reject(new Error('x'))) });
    const { user } = setup(api);
    await user.click(await screen.findByRole('button', { name: 'Meine Daten herunterladen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Das hat nicht geklappt');
  });
});

describe('ProfilePage – account deletion', () => {
  it('needs the confirmation, then deletes, clears the queue and signs out locally', async () => {
    const api = fakeApi();
    const { user, authClient, outboxStore } = setup(api, { queued: [queuedEntry('q1')] });

    await user.click(await screen.findByRole('button', { name: 'Konto löschen …' }));
    expect(
      screen.getByText('1 noch nicht gesendete Meldung auf diesem Gerät wird verworfen.'),
    ).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Konto endgültig löschen' });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /nicht rückgängig/ }));
    await user.click(confirm);

    expect(
      await screen.findByText('Ihr Konto und Ihre Daten wurden gelöscht.'),
    ).toBeInTheDocument();
    expect(api.deleteAccount).toHaveBeenCalledOnce();
    expect(authClient.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await outboxStore.list()).toEqual([]);
    // Signed out: the sign-in form is back, the data sections are gone.
    expect(screen.queryByRole('button', { name: 'Meine Daten herunterladen' })).toBeNull();
  });

  it('keeps everything when the server refuses', async () => {
    const api = fakeApi({ deleteAccount: vi.fn(async () => Promise.reject(new Error('x'))) });
    const { user, authClient } = setup(api);
    await user.click(await screen.findByRole('button', { name: 'Konto löschen …' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Konto endgültig löschen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Das hat nicht geklappt');
    expect(authClient.signOut).not.toHaveBeenCalled();
  });

  it('cancel closes the confirmation', async () => {
    const { user } = setup(fakeApi());
    await user.click(await screen.findByRole('button', { name: 'Konto löschen …' }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('anonymous users delete "my data"', async () => {
    setup(fakeApi(), { anonymous: true });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Meine Daten löschen' }),
    ).toBeInTheDocument();
  });
});

describe('ProfilePage – volunteer role', () => {
  it('is only shown to volunteers; leaving needs a confirmation', async () => {
    const api = fakeApi({
      isVolunteer: vi.fn(async () => true),
      leaveVolunteerRole: vi.fn(async () => 2),
    });
    const { user } = setup(api);
    await user.click(await screen.findByRole('button', { name: 'Freiwillige Mithilfe beenden' }));
    expect(api.leaveVolunteerRole).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Ja, beenden' }));
    expect(await screen.findByText(/Ihre freiwillige Mithilfe ist beendet/)).toHaveTextContent(
      '2 übernommene Meldungen wurden wieder freigegeben.',
    );
  });

  it('is hidden for non-volunteers', async () => {
    const api = fakeApi();
    setup(api);
    await waitFor(() => expect(api.isVolunteer).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Freiwillige Mithilfe' })).toBeNull();
  });
});

describe('ProfilePage – languages', () => {
  it('Arabic plural forms', async () => {
    await changeLanguage('ar', { persist: false });
    const { user } = setup(fakeApi(), { queued: [queuedEntry('a'), queuedEntry('b')] });
    await user.click(await screen.findByRole('button', { name: 'حذف الحساب …' }));
    expect(screen.getByText('سيُتجاهَل بلاغان على هذا الجهاز لم يُرسَلا بعد.')).toBeInTheDocument();
  });
});
