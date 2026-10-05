// PWA state shared with React: "a new version is waiting" and "the browser offers installing".
// main.tsx registers the service worker (production builds only) and reports updates here.
import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  /** Activates the waiting service worker and reloads; null while there is no update. */
  applyUpdate: (() => Promise<void>) | null;
  installPrompt: BeforeInstallPromptEvent | null;
}

let state: PwaState = { applyUpdate: null, installPrompt: null };
const listeners = new Set<() => void>();

function set(next: Partial<PwaState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function announceUpdate(apply: () => Promise<void>) {
  set({ applyUpdate: apply });
}

export function dismissUpdate() {
  set({ applyUpdate: null });
}

export function usePwaState(): PwaState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Shows the browser's install dialog; resolves true if the app was installed. */
export async function promptInstall(): Promise<boolean> {
  const event = state.installPrompt;
  if (!event) return false;
  // The event can be used only once.
  set({ installPrompt: null });
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
}

// Chromium fires this early, possibly before React renders: keep it for the install button.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    set({ installPrompt: event as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => set({ installPrompt: null }));
}

/** For tests. */
export function resetPwaState(next: Partial<PwaState> = {}) {
  set({ applyUpdate: null, installPrompt: null, ...next });
}
