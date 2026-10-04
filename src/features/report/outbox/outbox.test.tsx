import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeAuthClient, fakeSession } from '@/test/fakeAuth';
import { renderApp } from '@/test/render';
import { SubmitError, type ReportDraft, type ReportSubmitApi } from '../api';
import { createMemoryStore, type OutboxEntry } from './store';

const draft = (clientId: string): ReportDraft => ({
  clientId,
  lng: 10.11,
  lat: 53.38,
  accuracyM: 9,
  category: 'bulky',
  hazardType: null,
  size: 'pile',
  comment: '',
  photos: [{ id: `p-${clientId}`, blob: new Blob(['x']), ext: 'webp' }],
});

const entry = (id: string, over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id,
  draft: draft(id),
  state: 'pending',
  attempts: 1,
  lastError: 'network',
  nextAttemptAt: 0,
  createdAt: Date.UTC(2026, 9, 4, 8, 30),
  ...over,
});

function fakeApi(submit: ReportSubmitApi['submit']) {
  return {
    tenantAt: vi.fn(async () => null),
    nearby: vi.fn(async () => []),
    submit: vi.fn(submit),
  } satisfies ReportSubmitApi;
}

const offline = () =>
  fakeApi(async () => {
    throw new SubmitError('network');
  });

function setup(entries: OutboxEntry[], api: ReportSubmitApi, session = fakeSession()) {
  const store = createMemoryStore(entries);
  const authClient = fakeAuthClient(session);
  const utils = renderApp({
    route: '/app/profile',
    authClient,
    submitApi: api,
    outboxStore: store,
  });
  return { ...utils, store, authClient };
}

describe('offline queue in the app', () => {
  it('sends saved reports on start with the stored session, then says so', async () => {
    const api = fakeApi(async (d) => `report-${d.clientId}`);
    const { store, authClient, user } = setup([entry('a')], api);

    const notice = await screen.findByText('Gespeicherte Meldungen gesendet: 1');
    expect(api.submit).toHaveBeenCalledWith(draft('a'), fakeSession().user.id);
    expect(authClient.signInAnonymously).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Ausblenden' }));
    expect(notice).not.toBeInTheDocument();
  });

  it('several saved reports without a session: one anonymous user for all of them', async () => {
    const api = fakeApi(async (d) => `report-${d.clientId}`);
    const store = createMemoryStore([entry('a', { createdAt: 1 }), entry('b', { createdAt: 2 })]);
    const authClient = fakeAuthClient();
    renderApp({ route: '/app/profile', authClient, submitApi: api, outboxStore: store });

    await screen.findByText('Gespeicherte Meldungen gesendet: 2');
    expect(authClient.signInAnonymously).toHaveBeenCalledOnce();
    const users = new Set(vi.mocked(api.submit).mock.calls.map(([, uid]) => uid));
    expect(users).toEqual(new Set([fakeSession({ anonymous: true }).user.id]));
  });

  it('tries on start even before the planned retry; "Send now" retries right away', async () => {
    const api = offline();
    const { store, user } = setup([entry('a', { nextAttemptAt: Date.now() + 60_000 })], api);

    await waitFor(() => expect(api.submit).toHaveBeenCalledOnce());
    expect(await screen.findByText('Wartende Meldungen: 1')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Jetzt senden' })).toBeEnabled());

    api.submit.mockResolvedValue('report-a');
    await user.click(screen.getByRole('button', { name: 'Jetzt senden' }));
    await screen.findByText('Gespeicherte Meldungen gesendet: 1');
    expect(screen.queryByText(/Wartende Meldungen/)).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it('coming back online sends at once, even before the planned retry', async () => {
    const api = offline();
    setup([entry('a', { nextAttemptAt: Date.now() + 10 * 60_000 })], api);
    await screen.findByText('Wartende Meldungen: 1');

    api.submit.mockResolvedValue('report-a');
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await screen.findByText('Gespeicherte Meldungen gesendet: 1');
  });

  it('a failed attempt keeps the report waiting', async () => {
    const api = offline();
    const { store } = setup([entry('a')], api);
    await waitFor(() => expect(api.submit).toHaveBeenCalledOnce());
    expect(await screen.findByText('Wartende Meldungen: 1')).toBeInTheDocument();
    expect((await store.list())[0]).toMatchObject({ state: 'pending', attempts: 2 });
  });

  it('lists reports the server refused and lets the user discard them', async () => {
    const api = fakeApi(async () => 'never');
    const { store, user } = setup([entry('a', { state: 'failed', lastError: 'blocked' })], api);

    const alert = (await screen.findByText('Nicht gesendete Meldungen: 1')).closest('[role]')!;
    expect(alert).toHaveTextContent('Sperrmüll vom');
    expect(alert).toHaveTextContent('Ihr Konto ist gesperrt.');
    expect(api.submit).not.toHaveBeenCalled();

    await user.click(within(alert as HTMLElement).getByRole('button', { name: /verwerfen/ }));
    await waitFor(() => expect(screen.queryByText(/Nicht gesendete Meldungen/)).toBeNull());
    expect(await store.list()).toEqual([]);
  });

  it('shows nothing when the queue is empty', async () => {
    setup([], offline());
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/Meldungen/)).toBeNull();
  });
});
