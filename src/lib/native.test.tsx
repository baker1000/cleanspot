// The native (Capacitor) branches, with the plugins replaced by fakes.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/app/App';
import { CameraInput } from '@/components/ui/CameraInput';
import { renderWithProviders } from '@/test/render';
import type * as NativeModule from './native';

const native = vi.hoisted(() => ({
  isNative: vi.fn(() => false),
  takeNativePhoto: vi.fn<() => Promise<Blob | null>>(),
  nativePosition: vi.fn(),
  shareTextFile: vi.fn(async () => {}),
}));
vi.mock('@/lib/native', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeModule>()),
  ...native,
}));

afterEach(() => vi.clearAllMocks());

describe('CameraInput', () => {
  it('browser: a camera file input', () => {
    render(
      <CameraInput className="" native={false} onPhoto={vi.fn()} onError={vi.fn()}>
        Foto aufnehmen
      </CameraInput>,
    );
    const input = screen.getByLabelText('Foto aufnehmen');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('capture', 'environment');
  });

  it('native: a button that opens the system camera and returns the photo', async () => {
    const photo = new Blob(['jpeg'], { type: 'image/jpeg' });
    native.takeNativePhoto.mockResolvedValueOnce(photo);
    const onPhoto = vi.fn();
    render(
      <CameraInput className="" native onPhoto={onPhoto} onError={vi.fn()}>
        Foto aufnehmen
      </CameraInput>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Foto aufnehmen' }));
    await vi.waitFor(() => expect(onPhoto).toHaveBeenCalledWith(photo));
  });

  it('native: cancelling does nothing, a camera error is reported', async () => {
    const onPhoto = vi.fn();
    const onError = vi.fn();
    render(
      <CameraInput className="" native onPhoto={onPhoto} onError={onError}>
        Foto aufnehmen
      </CameraInput>,
    );
    native.takeNativePhoto.mockResolvedValueOnce(null);
    await userEvent.click(screen.getByRole('button'));
    native.takeNativePhoto.mockRejectedValueOnce(new Error('denied'));
    await userEvent.click(screen.getByRole('button'));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onPhoto).not.toHaveBeenCalled();
  });
});

describe('locateOnce in the native app', () => {
  it('uses the Geolocation plugin and maps a refusal to "denied"', async () => {
    const { locateOnce } = await import('./geolocation');
    native.isNative.mockReturnValue(true);
    native.nativePosition.mockResolvedValueOnce({ ok: true, lng: 10, lat: 53, accuracy: 7 });
    await expect(locateOnce()).resolves.toEqual({ lng: 10, lat: 53, accuracy: 7 });
    native.nativePosition.mockResolvedValueOnce({ ok: false, denied: true });
    await expect(locateOnce()).rejects.toMatchObject({ reason: 'denied' });
    native.nativePosition.mockResolvedValueOnce({ ok: false, denied: false });
    await expect(locateOnce()).rejects.toMatchObject({ reason: 'unavailable' });
    native.isNative.mockReturnValue(false);
  });
});

describe('data export in the native app', () => {
  it('goes to the share sheet instead of a browser download', async () => {
    const { saveExport } = await import('@/features/profile/api');
    native.isNative.mockReturnValue(true);
    await saveExport({ fileName: 'cleanspot-data-2026-10-05.json', json: '{}' });
    expect(native.shareTextFile).toHaveBeenCalledWith(
      'cleanspot-data-2026-10-05.json',
      '{}',
      'CleanSpot',
    );
    native.isNative.mockReturnValue(false);
  });
});

describe('start page', () => {
  it('the native app opens on the map, the website on the landing page', async () => {
    renderWithProviders(<AppRoutes native />, { route: '/' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Karte' })).toBeInTheDocument();
  });

  it('website', () => {
    render(
      <MemoryRouter>
        <AppRoutes native={false} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Weniger Müll in unserer Landschaft' }),
    ).toBeInTheDocument();
  });
});
