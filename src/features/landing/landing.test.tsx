import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resetPwaState } from '@/app/pwa';
import { changeLanguage } from '@/i18n';
import { renderApp } from '@/test/render';
import { createPublicStatsApi, type PublicStats } from './stats';

const STATS: PublicStats = {
  reports: 1234,
  open: 200,
  cleared: 1000,
  clearedLast30Days: 42,
  kgCleared: 18500,
  municipalities: 2,
};

describe('LandingPage', () => {
  it('shows live statistics', async () => {
    renderApp({ landing: { stats: { load: async () => STATS }, playStoreUrl: null } });
    const stats = await screen.findByRole('region', { name: 'CleanSpot in Zahlen' });
    expect(await screen.findByText('1.234')).toBeInTheDocument();
    expect(screen.getByText('18.500')).toBeInTheDocument();
    expect(stats).toHaveTextContent('kg Müll beseitigt (geschätzt)');
    expect(stats).toHaveAttribute('aria-busy', 'false');
  });

  it('says so when the numbers cannot be loaded', async () => {
    renderApp({
      landing: { stats: { load: () => Promise.reject(new Error('offline')) }, playStoreUrl: null },
    });
    expect(await screen.findByText('Die Zahlen sind gerade nicht verfügbar.')).toBeInTheDocument();
  });

  it('without a backend there is no statistics section', () => {
    renderApp();
    expect(screen.queryByRole('region', { name: 'CleanSpot in Zahlen' })).toBeNull();
    expect(screen.getByRole('link', { name: 'App öffnen' })).toHaveAttribute('href', '/app');
  });

  it('links to Google Play when configured, otherwise "coming soon"', () => {
    const url = 'https://play.google.com/store/apps/details?id=org.cleanspot.app';
    const { unmount } = renderApp({ landing: { stats: null, playStoreUrl: url } });
    expect(screen.getByRole('link', { name: 'Android-App bei Google Play' })).toHaveAttribute(
      'href',
      url,
    );
    unmount();
    renderApp();
    expect(screen.getByText(/erscheint bald bei Google Play/)).toBeInTheDocument();
  });

  it('offers installing when the browser allows it', async () => {
    const prompt = vi.fn(async () => {});
    renderApp();
    expect(screen.queryByRole('button', { name: 'App installieren' })).toBeNull();
    act(() =>
      resetPwaState({
        installPrompt: Object.assign(new Event('beforeinstallprompt'), {
          prompt,
          userChoice: Promise.resolve({ outcome: 'accepted' as const }),
        }),
      }),
    );
    await screen.findByRole('button', { name: 'App installieren' }).then((b) => b.click());
    expect(prompt).toHaveBeenCalledOnce();
    // The browser's prompt can be used only once.
    expect(await screen.findByRole('link', { name: 'App öffnen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'App installieren' })).toBeNull();
  });

  it('formats numbers for the language (Arabic)', async () => {
    await changeLanguage('ar', { persist: false });
    renderApp({ landing: { stats: { load: async () => STATS }, playStoreUrl: null } });
    expect(await screen.findByRole('heading', { name: 'CleanSpot بالأرقام' })).toBeInTheDocument();
    expect(await screen.findByText(new Intl.NumberFormat('ar').format(1234))).toBeInTheDocument();
  });
});

describe('public stats API', () => {
  it('GETs public_stats with the anon key and maps the fields', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            reports: 3,
            open: 1,
            cleared: 2,
            cleared_last_30_days: 1,
            kg_cleared: 45,
            municipalities: 1,
          }),
        ),
    );
    const api = createPublicStatsApi('https://x.supabase.co/', 'anon-key', fetchFn);
    expect(await api.load()).toEqual({
      reports: 3,
      open: 1,
      cleared: 2,
      clearedLast30Days: 1,
      kgCleared: 45,
      municipalities: 1,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://x.supabase.co/rest/v1/rpc/public_stats',
      expect.objectContaining({ headers: expect.objectContaining({ apikey: 'anon-key' }) }),
    );
  });

  it('fails on HTTP errors', async () => {
    const api = createPublicStatsApi(
      'https://x',
      'k',
      async () => new Response('', { status: 503 }),
    );
    await expect(api.load()).rejects.toThrow(/503/);
  });
});
