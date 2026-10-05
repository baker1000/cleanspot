import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/render';
import { announceUpdate, resetPwaState } from './pwa';
import { UpdatePrompt } from './UpdatePrompt';
import { renderWithProviders } from '@/test/render';

afterEach(() => resetPwaState());

describe('UpdatePrompt', () => {
  it('appears when a new version waits; the user decides when to reload', async () => {
    const apply = vi.fn(async () => {});
    const { user } = renderWithProviders(<UpdatePrompt />);
    expect(screen.queryByText('Eine neue Version von CleanSpot ist verfügbar.')).toBeNull();
    act(() => announceUpdate(apply));
    await user.click(screen.getByRole('button', { name: 'Jetzt aktualisieren' }));
    expect(apply).toHaveBeenCalledOnce();
  });

  it('"Later" hides it', async () => {
    const apply = vi.fn(async () => {});
    const { user } = renderWithProviders(<UpdatePrompt />);
    act(() => announceUpdate(apply));
    await user.click(screen.getByRole('button', { name: 'Später' }));
    expect(screen.queryByRole('button', { name: 'Jetzt aktualisieren' })).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('OfflineNotice', () => {
  it('shows while the device is offline', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderApp({ route: '/app/profile' });
    expect(screen.getByText(/Sie sind offline/)).toBeInTheDocument();
    onLine.mockReturnValue(true);
    act(() => void window.dispatchEvent(new Event('online')));
    expect(screen.queryByText(/Sie sind offline/)).toBeNull();
    onLine.mockRestore();
  });
});
