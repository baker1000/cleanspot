import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeAuthClient, fakeSession } from '@/test/fakeAuth';
import { fakeMap, viewportAround } from '@/test/fakeMapView';
import { renderWithProviders } from '@/test/render';
import { LocateFailure } from '@/lib/geolocation';
import { SubmitError, type ReportSubmitApi, type TenantInfo } from './api';
import { PhotoError } from './photo';
import { ReportPage, type ReportPageProps } from './ReportPage';

const GPS = { lng: 10.1105, lat: 53.3842, accuracy: 8 };
const HARBURG: TenantInfo = {
  kind: 'municipality',
  name: 'Landkreis Harburg',
  bulkyWasteUrl: null,
};

function fakeApi(over: Partial<ReportSubmitApi> = {}) {
  return {
    tenantAt: vi.fn(async () => HARBURG),
    nearby: vi.fn(async () => []),
    submit: vi.fn(async () => 'report-1'),
    ...over,
  } satisfies ReportSubmitApi;
}

const prepared = () => ({
  blob: new Blob(['webp'], { type: 'image/webp' }),
  ext: 'webp' as const,
  width: 1600,
  height: 1200,
});

function setup(
  opts: {
    api?: ReportSubmitApi | null;
    props?: Partial<ReportPageProps>;
    auth?: ReturnType<typeof fakeAuthClient>;
  } = {},
) {
  const api = opts.api === undefined ? fakeApi() : opts.api;
  const authClient = opts.auth ?? fakeAuthClient();
  const preparePhoto = vi.fn(async () => prepared());
  const locate = vi.fn(async () => GPS);
  const utils = renderWithProviders(
    <ReportPage geocoder={null} preparePhoto={preparePhoto} locate={locate} {...opts.props} />,
    { authClient, submitApi: api },
  );
  return { ...utils, api, authClient, preparePhoto, locate };
}

const photoFile = () => new File(['jpeg'], 'IMG_0001.jpg', { type: 'image/jpeg' });

async function fillIn(user: ReturnType<typeof setup>['user'], category = 'Sperrmüll') {
  await user.upload(screen.getByLabelText('Foto auswählen'), photoFile());
  await screen.findByRole('img', { name: 'Foto 1' });
  await user.click(screen.getByRole('button', { name: 'Meinen Standort verwenden' }));
  await screen.findByText(/Genauigkeit etwa 8 m/);
  await user.click(screen.getByRole('radio', { name: category }));
  await user.click(screen.getByRole('radio', { name: /Ein Haufen/ }));
}

describe('report form', () => {
  it('lists missing fields, links to them, and moves focus to the summary', async () => {
    const { user, api } = setup();
    await user.click(screen.getByRole('button', { name: 'Meldung absenden' }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('Bitte ergänzen Sie:');
    const links = within(summary).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'mindestens ein Foto',
      'den Ort',
      'die Art des Mülls',
      'die Menge',
    ]);
    await waitFor(() => expect(summary.parentElement).toHaveFocus());
    expect(api!.submit).not.toHaveBeenCalled();

    // Link moves focus into the group; filling it in removes the entry.
    await user.click(within(summary).getByRole('link', { name: 'die Art des Mülls' }));
    expect(screen.getByRole('group', { name: 'Art des Mülls' })).toHaveFocus();
    await user.click(screen.getByRole('radio', { name: 'Kunststoff' }));
    expect(within(screen.getByRole('alert')).queryByText('die Art des Mülls')).toBeNull();
  });

  it('submits anonymously: creates a session, sends the draft, confirms with focus', async () => {
    const { user, api, authClient } = setup();
    await fillIn(user);
    await user.type(screen.getByLabelText('Kommentar (freiwillig)'), 'Sofa am Feldweg');
    expect(screen.getByText('15 von 500 Zeichen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Meldung absenden' }));

    const heading = await screen.findByRole('heading', { name: 'Vielen Dank!' });
    expect(heading).toHaveFocus();
    expect(authClient.signInAnonymously).toHaveBeenCalledOnce();
    expect(api!.submit).toHaveBeenCalledWith(
      {
        clientId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        lng: GPS.lng,
        lat: GPS.lat,
        accuracyM: 8,
        category: 'bulky',
        hazardType: null,
        size: 'pile',
        comment: 'Sofa am Feldweg',
        photos: [
          { id: expect.stringMatching(/^[0-9a-f-]{36}$/), blob: expect.any(Blob), ext: 'webp' },
        ],
      },
      fakeSession({ anonymous: true }).user.id,
    );
    expect(screen.getByRole('link', { name: 'Meldung ansehen' })).toHaveAttribute(
      'href',
      '/app/reports/report-1',
    );
  });

  it('uses the existing session of a signed-in user', async () => {
    const auth = fakeAuthClient(fakeSession());
    const { user, api } = setup({ auth });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Meldung absenden' }));
    await screen.findByRole('heading', { name: 'Vielen Dank!' });
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
    expect(api!.submit).toHaveBeenCalledOnce();
  });

  it('keeps the draft after an error and retries with the same client id', async () => {
    const api = fakeApi({
      submit: vi
        .fn()
        .mockRejectedValueOnce(new SubmitError('network'))
        .mockResolvedValueOnce('report-1'),
    });
    const { user } = setup({ api });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Meldung absenden' }));
    expect(await screen.findByText(/Keine Verbindung/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Foto 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Meldung absenden' }));
    await screen.findByRole('heading', { name: 'Vielen Dank!' });
    const [first, second] = vi.mocked(api.submit).mock.calls;
    expect(second![0].clientId).toBe(first![0].clientId);
    expect(second![0].photos[0]!.id).toBe(first![0].photos[0]!.id);
  });

  it('starts a fresh draft with a new client id for the next report', async () => {
    const { user, api } = setup();
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Meldung absenden' }));
    await user.click(await screen.findByRole('button', { name: 'Weitere Meldung' }));
    expect(screen.queryByRole('img', { name: 'Foto 1' })).toBeNull();
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Meldung absenden' }));
    await screen.findByRole('heading', { name: 'Vielen Dank!' });
    const [first, second] = vi.mocked(api!.submit).mock.calls;
    expect(second![0].clientId).not.toBe(first![0].clientId);
  });

  it('shows the rate-limit message', async () => {
    const api = fakeApi({ submit: vi.fn().mockRejectedValue(new SubmitError('rate_limited')) });
    const { user } = setup({ api });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Meldung absenden' }));
    expect(await screen.findByText(/schon viele Meldungen gesendet/)).toBeInTheDocument();
  });

  it('disables sending without a backend', () => {
    setup({ api: null });
    expect(screen.getByText(/Der Server ist nicht eingerichtet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Meldung absenden' })).toBeDisabled();
  });
});

describe('hazardous waste', () => {
  it('warns, names the municipality and sends "other" when no type is chosen', async () => {
    const { user, api } = setup();
    await fillIn(user, 'Gefährlicher Abfall');
    expect(screen.getByText(/Bitte nicht berühren und Abstand halten/)).toBeInTheDocument();
    expect(screen.getByText(/112/)).toBeInTheDocument();
    expect(await screen.findByText('Ihre Meldung geht an: Landkreis Harburg.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Welcher gefährliche Abfall?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Meldung absenden' }));
    await screen.findByRole('heading', { name: 'Vielen Dank!' });
    expect(vi.mocked(api!.submit).mock.calls[0]![0]).toMatchObject({
      category: 'hazardous',
      hazardType: 'other',
    });
  });

  it('sends the chosen hazard type', async () => {
    const { user, api } = setup();
    await fillIn(user, 'Gefährlicher Abfall');
    await user.click(screen.getByRole('radio', { name: 'Asbest' }));
    await user.click(screen.getByRole('button', { name: 'Meldung absenden' }));
    await screen.findByRole('heading', { name: 'Vielen Dank!' });
    expect(vi.mocked(api!.submit).mock.calls[0]![0].hazardType).toBe('asbestos');
  });

  it('outside every municipality: tells the reporter to contact the local authority', async () => {
    const api = fakeApi({
      tenantAt: vi.fn(async () => ({
        kind: 'public' as const,
        name: 'CleanSpot Community',
        bulkyWasteUrl: null,
      })),
    });
    const { user } = setup({ api });
    await fillIn(user, 'Gefährlicher Abfall');
    expect(
      await screen.findByText(/außerhalb der teilnehmenden Kommunen.*örtliche Behörde/),
    ).toBeInTheDocument();
  });

  it('unknown recipient (lookup failed): still points to the local authority', async () => {
    const api = fakeApi({ tenantAt: vi.fn(async () => null) });
    const { user } = setup({ api });
    await fillIn(user, 'Gefährlicher Abfall');
    expect(
      await screen.findByText(/im Zweifel zusätzlich Ihre örtliche Behörde/),
    ).toBeInTheDocument();
  });
});

describe('location', () => {
  it('takes the crosshair only when zoomed in far enough', async () => {
    const { user } = setup();
    await screen.findByRole('region', { name: 'Karte zur Ortswahl' });
    const take = screen.getByRole('button', { name: 'Fadenkreuz als Ort übernehmen' });

    act(() => fakeMap.emitViewport(viewportAround([10.12, 53.38], 12)));
    expect(take).toBeDisabled();
    expect(screen.getByText(/zoomen Sie weiter hinein/)).toBeInTheDocument();

    act(() => fakeMap.emitViewport(viewportAround([10.12345, 53.38765], 17)));
    await user.click(take);
    expect(screen.getByText('Ort: 53,38765, 10,12345')).toBeInTheDocument();
    expect(screen.queryByText(/Genauigkeit/)).toBeNull();
  });

  it('GPS centres the map and shows the accuracy', async () => {
    const { user } = setup();
    await screen.findByRole('region', { name: 'Karte zur Ortswahl' });
    await user.click(screen.getByRole('button', { name: 'Meinen Standort verwenden' }));
    expect(await screen.findByText(/Genauigkeit etwa 8 m/)).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('map-focus').textContent!)).toMatchObject({
      center: [GPS.lng, GPS.lat],
      zoom: 17,
    });
  });

  it('explains a denied permission', async () => {
    const locate = vi.fn().mockRejectedValue(new LocateFailure('denied'));
    const { user } = setup({ props: { locate } });
    await user.click(screen.getByRole('button', { name: 'Meinen Standort verwenden' }));
    expect(await screen.findByText(/Standortzugriff wurde verweigert/)).toBeInTheDocument();
  });

  it('warns about open reports nearby with links to them', async () => {
    const api = fakeApi({
      nearby: vi.fn(async () => [
        { id: 'n1', distanceM: 12.4, category: 'bulky' as const, status: 'reported' },
      ]),
    });
    const { user } = setup({ api });
    await user.click(screen.getByRole('button', { name: 'Meinen Standort verwenden' }));
    expect(
      await screen.findByText('In der Nähe gibt es bereits 1 offene Meldung'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sperrmüll, 12 m entfernt' })).toHaveAttribute(
      'href',
      '/app/reports/n1',
    );
    expect(api.nearby).toHaveBeenCalledWith(GPS.lng, GPS.lat, expect.any(AbortSignal));
  });
});

describe('photos', () => {
  it('prepares every photo, allows removing, and stops at three', async () => {
    const { user, preparePhoto } = setup();
    await user.upload(screen.getByLabelText('Foto auswählen'), [photoFile(), photoFile()]);
    await screen.findByRole('img', { name: 'Foto 2' });
    expect(preparePhoto).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Foto 1 entfernen' }));
    expect(screen.queryByRole('img', { name: 'Foto 2' })).toBeNull();
    expect(screen.getByLabelText('Foto auswählen')).toHaveFocus();

    await user.upload(screen.getByLabelText('Foto auswählen'), [
      photoFile(),
      photoFile(),
      photoFile(),
    ]);
    await screen.findByRole('img', { name: 'Foto 3' });
    expect(preparePhoto).toHaveBeenCalledTimes(4); // only 2 more fit
    expect(screen.queryByLabelText('Foto auswählen')).toBeNull();
    expect(screen.getByText(/Höchstzahl von 3 Fotos/)).toBeInTheDocument();
  });

  it('offers the camera directly', () => {
    setup();
    expect(screen.getByLabelText('Foto aufnehmen')).toHaveAttribute('capture', 'environment');
  });

  it('explains photos that cannot be used', async () => {
    const { user } = setup({
      props: { preparePhoto: vi.fn().mockRejectedValue(new PhotoError('unsupported')) },
    });
    await user.upload(screen.getByLabelText('Foto auswählen'), photoFile());
    expect(await screen.findByText(/Bildformat wird nicht unterstützt/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
