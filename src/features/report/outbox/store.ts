// Reports waiting on this device until they reach the server (offline queue). Entries keep the
// whole draft including the photo blobs, so nothing depends on the network until sync.
import { committed, createDbOpener, done, OUTBOX_STORE } from '@/lib/idb';
import type { ReportDraft, SubmitErrorReason } from '../api';

/** Why the last attempt failed; "session" = no (anonymous) sign-in was possible. */
export type OutboxError = SubmitErrorReason | 'session';

export interface OutboxEntry {
  /** Same as draft.clientId, so the server sees every retry as the same report. */
  id: string;
  draft: ReportDraft;
  /** pending = will be retried; failed = the server refused it, only the user can discard it. */
  state: 'pending' | 'failed';
  attempts: number;
  lastError: OutboxError | null;
  /** Epoch ms; background sync skips the entry until then. */
  nextAttemptAt: number;
  createdAt: number;
}

export interface OutboxStore {
  /** Oldest first. */
  list(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  delete(id: string): Promise<void>;
}

const byAge = (a: OutboxEntry, b: OutboxEntry) => a.createdAt - b.createdAt;

/** For tests. (Without IndexedDB there is no queue: a report kept only in memory would be lost.) */
export function createMemoryStore(initial: OutboxEntry[] = []): OutboxStore {
  const entries = new Map(initial.map((e) => [e.id, e]));
  return {
    list: async () => [...entries.values()].sort(byAge),
    put: async (entry) => void entries.set(entry.id, entry),
    delete: async (id) => void entries.delete(id),
  };
}

/**
 * IndexedDB store. Blobs are stored natively (structured clone), no base64. The service worker
 * opens the same store for Background Sync.
 */
export function createIndexedDbStore(factory: IDBFactory = indexedDB): OutboxStore {
  const db = createDbOpener(factory);

  const write = async (fn: (store: IDBObjectStore) => IDBRequest) => {
    const tx = (await db()).transaction(OUTBOX_STORE, 'readwrite');
    fn(tx.objectStore(OUTBOX_STORE));
    await committed(tx);
  };

  return {
    async list() {
      const tx = (await db()).transaction(OUTBOX_STORE, 'readonly');
      const entries = await done(
        tx.objectStore(OUTBOX_STORE).getAll() as IDBRequest<OutboxEntry[]>,
      );
      return entries.sort(byAge);
    },
    put: (entry) => write((s) => s.put(entry)),
    delete: (id) => write((s) => s.delete(id)),
  };
}

/** The store for this device, or null without IndexedDB (then reports are only sent directly). */
export function defaultOutboxStore(): OutboxStore | null {
  return typeof indexedDB === 'undefined' ? null : createIndexedDbStore();
}
