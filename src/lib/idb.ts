// The app's one IndexedDB database, shared by the page and the service worker:
//   outbox – reports waiting to be sent (see features/report/outbox/store.ts)
//   kv     – small values, e.g. the mirrored auth session (see lib/authStorage.ts)
const DB_NAME = 'cleanspot';
const DB_VERSION = 2;
export const OUTBOX_STORE = 'outbox';
export const KV_STORE = 'kv';

export const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Resolves once the transaction is committed, not when its request succeeded. */
export const committed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

/**
 * Returns a lazy opener. A failed open (e.g. storage blocked) is retried on the next call instead
 * of being cached; a schema upgrade from another tab or the service worker closes this connection.
 */
export function createDbOpener(factory: IDBFactory = indexedDB): () => Promise<IDBDatabase> {
  let opening: Promise<IDBDatabase> | null = null;
  return () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const names = request.result.objectStoreNames;
        if (!names.contains(OUTBOX_STORE)) {
          request.result.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
        }
        if (!names.contains(KV_STORE)) request.result.createObjectStore(KV_STORE);
      };
      request.onsuccess = () => {
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
}

export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createMemoryKv(initial: Record<string, unknown> = {}): KeyValueStore {
  const values = new Map(Object.entries(initial));
  return {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
}

export function createIndexedDbKv(factory: IDBFactory = indexedDB): KeyValueStore {
  const db = createDbOpener(factory);
  const write = async (fn: (store: IDBObjectStore) => IDBRequest) => {
    const tx = (await db()).transaction(KV_STORE, 'readwrite');
    fn(tx.objectStore(KV_STORE));
    await committed(tx);
  };
  return {
    async get<T>(key: string) {
      const tx = (await db()).transaction(KV_STORE, 'readonly');
      return (await done(tx.objectStore(KV_STORE).get(key))) as T | undefined;
    },
    set: (key, value) => write((s) => s.put(value, key)),
    delete: (key) => write((s) => s.delete(key)),
  };
}

/** The device's key-value store, or null without IndexedDB. */
export function defaultKv(): KeyValueStore | null {
  return typeof indexedDB === 'undefined' ? null : createIndexedDbKv();
}
