import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { LocateFailure } from '@/lib/geolocation';
import { fakeAuthClient, fakeSession } from '@/test/fakeAuth';
import { detail, fakeDetailApi, viewer } from '@/test/fakeDetail';
import { renderWithProviders } from '@/test/render';
import { ActionError, type DetailApi, type ReportDetail } from './api';
import { DetailPage } from './DetailPage';

const ID = 'r0000000-0000-4000-8000-000000000001';
const UID = fakeSession().user.id;
const NEAR = { lng: 10.1105, lat: 53.3843, accuracy: 6 }; // ~11 m from the report
const FAR = { lng: 10.1105, lat: 53.3853, accuracy: 6 }; // ~122 m

function setup(
  api: DetailApi | null,
  { registered = false, locate = vi.fn(async () => NEAR) } = {},
) {
  const authClient = fakeAuthClient(registered ? fakeSession() : null);
  const preparePhoto = vi.fn(async () => ({
    blob: new Blob(['webp'], { type: 'image/webp' }),
    ext: 'webp' as const,
    width: 1600,
    height: 1200,
  }));
  const utils = renderWithProviders(
    <Routes>
      <Route
        path="/app/reports/:id"
        element={<DetailPage preparePhoto={preparePhoto} locate={locate} />}
      />
    </Routes>,
    { route: `/app/reports/${ID}`, authClient, detailApi: api },
  );
  return { ...utils, api, locate, preparePhoto };
}

const volunteer = (over: Partial<ReportDetail> = {}) => detail({ viewer: viewer(), ...over });

describe('report detail page', () => {
  it('shows the report, its photos, the route and the history to visitors', async () => {
    const api = fakeDetailApi(
      detail({
        comment: 'Sofa am Feldweg',
        isPublished: true,
        confirmationCount: 2,
        photos: [
          { id: 'p1', kind: 'before', url: 'https://x/p1', pending: false, takenAt: null },
          { id: 'p2', kind: 'before', url: null, pending: false, takenAt: null },
        ],
        events: [
          {
            id: 'e1',
            type: 'created',
            fromStatus: null,
            toStatus: 'reported',
            createdAt: '2026-10-01T10:00:00Z',
          },
          {
            id: 'e2',
            type: 'confirmed',
            fromStatus: null,
            toStatus: null,
            createdAt: '2026-10-02T10:00:00Z',
          },
        ],
      }),
    );
    setup(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'Sperrmüll' })).toBeInTheDocument();
    expect(api.load).toHaveBeenCalledWith(ID, null, expect.any(AbortSignal));
    expect(screen.getAllByText('Gemeldet')).toHaveLength(2); // status and first history entry
    expect(screen.getByText('etwa 40 kg')).toBeInTheDocument();
    expect(screen.getByText('Landkreis Harburg')).toBeInTheDocument();
    expect(screen.getByText('2 Bestätigungen')).toBeInTheDocument();
    expect(screen.getByText('Sofa am Feldweg')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Foto 1' })).toHaveAttribute('src', 'https://x/p1');
    expect(screen.getByText('Foto kann nicht geladen werden.')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Route (OpenStreetMap)' })).toHaveAttribute(
      'href',
      expect.stringContaining('openstreetmap.org/directions?route=%3B53.384200%2C10.110500'),
    );
    expect(screen.getByRole('link', { name: 'In Karten-App öffnen' })).toHaveAttribute(
      'href',
      'geo:53.384200,10.110500?q=53.384200,10.110500',
    );

    const history = screen.getByRole('region', { name: 'Verlauf' });
    expect(
      within(history)
        .getAllByRole('listitem')
        .map((li) => li.firstChild?.textContent),
    ).toEqual(['Gemeldet', 'Von jemandem bestätigt']);

    // No account: the actions point there instead of offering buttons that would fail.
    expect(screen.queryByRole('button', { name: 'Ich sehe das auch' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Zum Konto' })).toHaveAttribute('href', '/app/profile');
  });

  it('marks own photos that are still under review', async () => {
    setup(
      fakeDetailApi(
        detail({
          reportedByMe: true,
          photos: [{ id: 'p1', kind: 'before', url: 'https://x/p1', pending: true, takenAt: null }],
        }),
      ),
    );
    expect(await screen.findByText('Wird geprüft: Nur Sie sehen dieses Foto.')).toBeInTheDocument();
    expect(
      screen.getByText('Fotos und Kommentar werden nach der Prüfung öffentlich angezeigt.'),
    ).toBeInTheDocument();
  });

  it('unknown report', async () => {
    setup(fakeDetailApi(null));
    expect(
      await screen.findByText('Diese Meldung gibt es nicht oder sie ist nicht mehr öffentlich.'),
    ).toBeInTheDocument();
  });

  it('load error with retry', async () => {
    const api = fakeDetailApi(detail(), {
      load: vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValue(detail()),
    });
    const { user } = setup(api);
    await screen.findByText('Die Meldung konnte nicht geladen werden.');
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sperrmüll' })).toBeInTheDocument();
  });

  it('a registered user confirms; the page reloads with the new state', async () => {
    const api = fakeDetailApi(volunteer());
    const { user } = setup(api, { registered: true });
    await user.click(await screen.findByRole('button', { name: 'Ich sehe das auch' }));

    expect(api.confirm).toHaveBeenCalledWith(ID);
    expect(await screen.findByText('Danke für Ihre Bestätigung.')).toBeInTheDocument();
    expect(api.load.mock.calls.at(-1)!.slice(0, 2)).toEqual([ID, UID]);
  });

  it('without a membership: join as volunteer first, then claim', async () => {
    const api = fakeDetailApi(detail({ viewer: viewer({ role: 'none' }) }));
    const { user } = setup(api, { registered: true });
    const join = await screen.findByRole('button', { name: 'Als Freiwillige/r mitmachen' });
    expect(screen.queryByRole('button', { name: 'Ich räume das auf' })).toBeNull();

    api.load.mockResolvedValue(volunteer());
    await user.click(join);
    expect(api.joinAsVolunteer).toHaveBeenCalledWith(UID, 'pub');
    expect(await screen.findByText('Willkommen als Freiwillige/r!')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ich räume das auf' }));
    expect(api.claim).toHaveBeenCalledWith(ID);
  });

  it('someone else was faster: explains it and shows the current state', async () => {
    const api = fakeDetailApi(volunteer(), {
      claim: vi.fn().mockRejectedValue(new ActionError('claimed')),
    });
    const { user } = setup(api, { registered: true });
    const claim = await screen.findByRole('button', { name: 'Ich räume das auf' });
    api.load.mockResolvedValue(volunteer({ status: 'in_progress', isClaimed: true }));
    await user.click(claim);

    expect(
      await screen.findByText('Jemand anderes kümmert sich bereits um diese Meldung.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Jemand kümmert sich bereits darum.')).toBeInTheDocument();
  });

  it('hazardous waste: no claim for volunteers', async () => {
    setup(
      fakeDetailApi(volunteer({ isHazardous: true, category: 'hazardous', hazardType: 'oil' })),
      {
        registered: true,
      },
    );
    expect(await screen.findByText('Öl oder Treibstoff')).toBeInTheDocument();
    expect(
      screen.getAllByText('Gefährlicher Abfall wird nur von Fachleuten der Kommune beseitigt.'),
    ).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Ich räume das auf' })).toBeNull();
  });

  describe('after-photo', () => {
    const mine = () => volunteer({ status: 'in_progress', isClaimed: true, claimedByMe: true });
    const photo = () => new File(['jpeg'], 'IMG_0009.jpg', { type: 'image/jpeg' });

    it('takes the photo with the location of that moment and marks the report cleared', async () => {
      const api = fakeDetailApi(mine());
      const { user, locate, preparePhoto } = setup(api, { registered: true });
      await user.upload(
        await screen.findByLabelText('Foto nach der Beseitigung aufnehmen'),
        photo(),
      );

      expect(
        await screen.findByRole('img', { name: 'Vorschau des Fotos nach der Beseitigung' }),
      ).toBeInTheDocument();
      expect(preparePhoto).toHaveBeenCalledOnce(); // EXIF stripped, re-encoded
      expect(locate).toHaveBeenCalledOnce();
      expect(await screen.findByText('Sie sind etwa 11 m entfernt.')).toBeInTheDocument();

      api.load.mockResolvedValue(mine());
      await user.click(screen.getByRole('button', { name: 'Als beseitigt melden' }));
      expect(api.submitCleanup).toHaveBeenCalledWith(
        {
          reportId: ID,
          photo: {
            id: expect.stringMatching(/^[0-9a-f-]{36}$/),
            blob: expect.any(Blob),
            ext: 'webp',
          },
          lng: NEAR.lng,
          lat: NEAR.lat,
          accuracyM: 6,
          takenAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        },
        UID,
      );
      expect(
        await screen.findByText('Danke! Die Meldung ist als beseitigt markiert.'),
      ).toBeInTheDocument();
    });

    it('too far away: cannot send until the location is updated close enough', async () => {
      const locate = vi.fn().mockResolvedValueOnce(FAR).mockResolvedValueOnce(NEAR);
      const api = fakeDetailApi(mine());
      const { user } = setup(api, { registered: true, locate });
      await user.upload(
        await screen.findByLabelText('Foto nach der Beseitigung aufnehmen'),
        photo(),
      );

      expect(await screen.findByText(/Das ist mehr als 50 m/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Als beseitigt melden' })).toBeDisabled();

      await user.click(screen.getByRole('button', { name: 'Standort aktualisieren' }));
      await screen.findByText('Sie sind etwa 11 m entfernt.');
      expect(screen.getByRole('button', { name: 'Als beseitigt melden' })).toBeEnabled();
    });

    it('location denied: says why it is needed', async () => {
      const locate = vi.fn().mockRejectedValue(new LocateFailure('denied'));
      const { user } = setup(fakeDetailApi(mine()), { registered: true, locate });
      await user.upload(
        await screen.findByLabelText('Foto nach der Beseitigung aufnehmen'),
        photo(),
      );
      expect(await screen.findByText(/wird Ihr Standort benötigt/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Als beseitigt melden' })).toBeDisabled();
    });

    it('the server measured too far: shows its numbers', async () => {
      const api = fakeDetailApi(mine(), {
        submitCleanup: vi
          .fn()
          .mockRejectedValue(new ActionError('too_far', { meters: 63.4, maxMeters: 50 })),
      });
      const { user } = setup(api, { registered: true });
      await user.upload(
        await screen.findByLabelText('Foto nach der Beseitigung aufnehmen'),
        photo(),
      );
      await screen.findByText('Sie sind etwa 11 m entfernt.');
      await user.click(screen.getByRole('button', { name: 'Als beseitigt melden' }));
      expect(
        await screen.findByText(
          'Das Foto wurde 63 m vom Müll entfernt aufgenommen; erlaubt sind höchstens 50 m.',
        ),
      ).toBeInTheDocument();
    });

    it('give the report back', async () => {
      const api = fakeDetailApi(mine());
      const { user } = setup(api, { registered: true });
      await user.click(await screen.findByRole('button', { name: 'Wieder abgeben' }));
      expect(api.unclaim).toHaveBeenCalledWith(ID);
      await waitFor(() => expect(screen.getByText('Die Meldung ist wieder offen.')).toBeVisible());
    });
  });
});
