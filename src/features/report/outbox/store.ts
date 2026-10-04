// Reports waiting on this device until they reach the server (offline queue). Entries keep the
// whole draft including the photo blobs, so nothing depends on the network until sync.
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

const DB_NAME = 'cleanspot';
const DB_VERSION = 1;
const OUTBOX = 'outbox';

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * IndexedDB store. Blobs are stored natively (structured clone), no base64. Opening is lazy and
 * a failed open (e.g. storage blocked) is retried on the next call instead of being cached.
 */
export function createIndexedDbStore(factory: IDBFactory = indexedDB): OutboxStore {
  let opening: Promise<IDBDatabase> | null = null;

  const db = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OUTBOX)) {
          request.result.createObjectStore(OUTBOX, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        // Another tab upgrading the schema later must not be blocked by this connection.
        request.result.onversionchange = () => {
          request.result.close();
          opening = null;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    }).catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  };

  const write = async (fn: (store: IDBObjectStore) => IDBRequest) => {
    const tx = (await db()).transaction(OUTBOX, 'readwrite');
    fn(tx.objectStore(OUTBOX));
    // Resolve only once the transaction is committed, not when the request succeeded.
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  };

  return {
    async list() {
      const tx = (await db()).transaction(OUTBOX, 'readonly');
      const entries = await done(tx.objectStore(OUTBOX).getAll() as IDBRequest<OutboxEntry[]>);
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
