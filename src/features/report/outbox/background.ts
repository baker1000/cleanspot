// Background Sync for the offline queue (Chromium / Android; elsewhere the page alone sends).
// The page registers a sync whenever reports are waiting. When the browser fires it:
//   - a page of the app is open → the service worker asks it to send (it already holds the session)
//   - no page is open → the service worker sends the queue itself (runBackgroundSync)
// Reports sent while no page was open are counted in IndexedDB, so the next page can say so.
import type { KeyValueStore } from '@/lib/idb';
import type { OutboxStore } from './store';
import { syncOutbox, type SyncDeps } from './sync';

export const SYNC_TAG = 'cleanspot-outbox';
/** Message from the service worker to open pages: "send the queue now". */
export const SYNC_MESSAGE = 'cleanspot:outbox-sync';
/** Web Lock held by whoever sends the queue (pages and the service worker). */
export const OUTBOX_LOCK = 'cleanspot-outbox';
export const SENT_WHILE_CLOSED_KEY = 'outbox:sentWhileClosed';

type Lock = <T>(job: () => Promise<T>) => Promise<T>;

export const webLock: Lock = (job) =>
  typeof navigator !== 'undefined' && 'locks' in navigator
    ? navigator.locks.request(OUTBOX_LOCK, job)
    : job();

/**
 * Service worker side. Resolves with the number of reports sent; rejects while reports are still
 * waiting for a connection, so the browser tries again later (with its own backoff).
 */
export async function runBackgroundSync({
  store,
  deps,
  kv,
  lock = webLock,
}: {
  store: OutboxStore;
  deps: SyncDeps;
  kv: KeyValueStore;
  lock?: Lock;
}): Promise<number> {
  const { sent, remaining } = await lock(() => syncOutbox(store, deps, { force: true }));
  if (sent.length) {
    const before = (await kv.get<number>(SENT_WHILE_CLOSED_KEY).catch(() => 0)) ?? 0;
    await kv.set(SENT_WHILE_CLOSED_KEY, before + sent.length).catch(() => {});
  }
  if (remaining) throw new Error('Reports still waiting; the browser will retry the sync');
  return sent.length;
}

/** Page side; every method is a no-op where the browser lacks the feature. */
export interface OutboxBackground {
  /** Asks the browser to wake the service worker once there is a connection. */
  register(): Promise<void>;
  /** Called when the service worker asks this page to send. Returns an unsubscribe function. */
  onSyncRequest(cb: () => void): () => void;
  /** How many reports the service worker sent while no page was open (and resets the count). */
  takeSentWhileClosed(): Promise<number>;
}

interface SyncRegistration extends ServiceWorkerRegistration {
  sync?: { register(tag: string): Promise<void> };
}

export function createBrowserBackground(kv: KeyValueStore | null): OutboxBackground {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  // Effects can run twice (React StrictMode): a second caller must not count the same reports.
  let taking = false;
  return {
    async register() {
      try {
        // getRegistration (not `ready`): it does not wait forever where no worker is installed.
        const reg = (await sw?.getRegistration()) as SyncRegistration | undefined;
        if (reg?.active && reg.sync) await reg.sync.register(SYNC_TAG);
      } catch {
        // Not allowed (e.g. permission policy): the page keeps sending on its own.
      }
    },
    onSyncRequest(cb) {
      if (!sw) return () => {};
      const listener = (event: MessageEvent) => {
        if ((event.data as { type?: unknown } | null)?.type === SYNC_MESSAGE) cb();
      };
      sw.addEventListener('message', listener);
      return () => sw.removeEventListener('message', listener);
    },
    async takeSentWhileClosed() {
      if (!kv || taking) return 0;
      taking = true;
      try {
        const count = (await kv.get<number>(SENT_WHILE_CLOSED_KEY)) ?? 0;
        if (count) await kv.delete(SENT_WHILE_CLOSED_KEY);
        return count;
      } catch {
        return 0;
      } finally {
        taking = false;
      }
    },
  };
}

export const noBackground: OutboxBackground = {
  register: async () => {},
  onSyncRequest: () => () => {},
  takeSentWhileClosed: async () => 0,
};
