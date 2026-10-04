import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ActionError } from '@/features/detail/api';
import { LocateFailure } from '@/lib/geolocation';
import { fakeAuthClient, fakeSession } from '@/test/fakeAuth';
import { renderApp, renderWithProviders } from '@/test/render';
import type { PickupStop, PickupsApi } from './api';
import { PickupsPage } from './PickupsPage';

const UID = fakeSession().user.id;
const TENANT = { id: 't-harburg', name: 'Landkreis Harburg' };

// Three stops on a north–south line, given out of order (~111 m per 0.001° latitude).
const stop = (id: string, dLat: number, over: Partial<PickupStop> = {}): PickupStop => ({
  id,
  reportId: `r-${id}`,
  lng: 10.1,
  lat: 53.38 + dLat / 1000,
  accuracyM: 5,
  bagCount: 2,
  estimatedKg: 12,
  category: 'mixed',
  createdAt: '2026-10-04T08:00:00Z',
  photoUrl: null,
  ...over,
});
const NORTH_OF_ALL = { lng: 10.1, lat: 53.38 + 0.02, accuracy: 10 };
const STOPS = [
  stop('mid', 5),
  stop('south', 0, { bagCount: 4, estimatedKg: 24 }),
  stop('north', 10),
];

type FakePickupsApi = { [K in keyof PickupsApi]: Mock<PickupsApi[K]> };

function fakeApi(over: Partial<FakePickupsApi> = {}): FakePickupsApi {
  return {
    staffTenants: vi.fn<PickupsApi['staffTenants']>(async () => [TENANT]),
    openTasks: vi.fn<PickupsApi['openTasks']>(async () => STOPS),
    collect: vi.fn<PickupsApi['collect']>(async () => {}),
    cancel: vi.fn<PickupsApi['cancel']>(async () => {}),
    ...over,
  };
}

function setup(api: PickupsApi, registered = true, locate = vi.fn(async () => NORTH_OF_ALL)) {
  return renderWithProviders(
    <Routes>
      <Route path="/app/pickups" element={<PickupsPage locate={locate} />} />
    </Routes>,
    {
      route: '/app/pickups',
      authClient: fakeAuthClient(registered ? fakeSession() : null),
      pickupsApi: api,
    },
  );
}

const stopHeadings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('pickup route page', () => {
  it('orders the open pickups into a route and sums them up', async () => {
    const api = fakeApi();
    setup(api);
    await screen.findByText(/^Stopps: 3/);
    expect(api.staffTenants).toHaveBeenCalledWith(UID);
    expect(api.openTasks).toHaveBeenCalledWith(TENANT.id);
    // Along the line, not in the given order.
    expect(['1. Gemischter Müll', '2. Gemischter Müll', '3. Gemischter Müll']).toEqual(
      stopHeadings(),
    );
    const items = screen.getAllByRole('listitem').filter((li) => li.closest('ol'));
    const firstReport = within(items[0]!).getByRole('link', { name: 'Zur Meldung' });
    expect(['/app/reports/r-south', '/app/reports/r-north']).toContain(
      firstReport.getAttribute('href'),
    );
    expect(screen.getByText(/Säcke: 8 · etwa 48 kg · 1,1 km Luftlinie/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Route öffnen (routing.openstreetmap.de)' }),
    ).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\/routing\.openstreetmap\.de\/\?loc=/),
    );
  });

  it('from my location: starts at the nearest end', async () => {
    const { user } = setup(fakeApi());
    await screen.findByText(/^Stopps: 3/);
    await user.click(screen.getByRole('button', { name: 'Von meinem Standort starten' }));

    expect(await screen.findByText('Die Route beginnt an Ihrem Standort.')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').filter((li) => li.closest('ol'));
    expect(within(items[0]!).getByRole('link', { name: 'Zur Meldung' })).toHaveAttribute(
      'href',
      '/app/reports/r-north',
    );
    expect(within(items[0]!).getByText(/von Ihrem Standort$/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Route öffnen/ })).toHaveAttribute(
      'href',
      expect.stringContaining('loc=53.400000%2C10.100000&loc=53.390000'),
    );
  });

  it('location not available: says so', async () => {
    const { user } = setup(fakeApi(), true, vi.fn().mockRejectedValue(new LocateFailure('denied')));
    await screen.findByText(/^Stopps: 3/);
    await user.click(screen.getByRole('button', { name: 'Von meinem Standort starten' }));
    expect(await screen.findByText(/wird Ihr Standort benötigt/)).toBeInTheDocument();
  });

  it('collected: the stop leaves the route', async () => {
    const api = fakeApi();
    const { user } = setup(api);
    await screen.findByText(/^Stopps: 3/);
    await user.click(screen.getByRole('button', { name: 'Stopp 1 als abgeholt markieren' }));
    expect(api.collect).toHaveBeenCalledOnce();
    expect(await screen.findByText('Stopp als abgeholt markiert.')).toBeInTheDocument();
    expect(screen.getByText(/^Stopps: 2/)).toBeInTheDocument();
  });

  it('not there: removes the pickup', async () => {
    const api = fakeApi();
    const { user } = setup(api);
    await screen.findByText(/^Stopps: 3/);
    await user.click(screen.getByRole('button', { name: 'Stopp 2: Säcke nicht vorhanden' }));
    expect(api.cancel).toHaveBeenCalledOnce();
    expect(
      await screen.findByText('Abholung entfernt: Säcke nicht vorhanden.'),
    ).toBeInTheDocument();
  });

  it('someone else collected it already: reloads the list', async () => {
    const api = fakeApi({ collect: vi.fn().mockRejectedValue(new ActionError('status')) });
    const { user } = setup(api);
    await screen.findByText(/^Stopps: 3/);
    api.openTasks.mockResolvedValue(STOPS.slice(1));
    await user.click(screen.getByRole('button', { name: 'Stopp 1 als abgeholt markieren' }));
    expect(await screen.findByText(/hat sich inzwischen geändert/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/^Stopps: 2/)).toBeInTheDocument());
  });

  it('no open pickups', async () => {
    setup(fakeApi({ openTasks: vi.fn(async () => []) }));
    expect(
      await screen.findByText('Zurzeit gibt es keine offenen Abholungen.'),
    ).toBeInTheDocument();
  });

  it('not staff / not signed in', async () => {
    setup(fakeApi({ staffTenants: vi.fn(async () => []) }));
    expect(
      await screen.findByText('Diese Seite ist für Mitarbeitende der Kommune.'),
    ).toBeInTheDocument();
  });

  it('visitors are asked to sign in', async () => {
    const api = fakeApi();
    setup(api, false);
    expect(await screen.findByText(/Mitarbeiterin oder Mitarbeiter an/)).toBeInTheDocument();
    expect(api.staffTenants).not.toHaveBeenCalled();
  });

  it('staff get a link on their profile page', async () => {
    renderApp({
      route: '/app/profile',
      authClient: fakeAuthClient(fakeSession()),
      pickupsApi: fakeApi(),
    });
    expect(await screen.findByRole('link', { name: 'Abholroute für Müllsäcke' })).toHaveAttribute(
      'href',
      '/app/pickups',
    );
  });
});
