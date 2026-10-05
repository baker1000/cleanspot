import { describe, expect, it } from 'vitest';
import { createSharedAuthStorage, type SyncStorage } from './authStorage';
import { createMemoryKv } from './idb';

const KEY = 'sb-x-auth-token';
const session = (expires_at: number) => JSON.stringify({ access_token: 'a', expires_at });

function memoryLocal(
  initial: Record<string, string> = {},
): SyncStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('shared auth storage', () => {
  it('writes and removes in both places', async () => {
    const kv = createMemoryKv();
    const local = memoryLocal();
    const storage = createSharedAuthStorage(kv, local);
    await storage.setItem(KEY, session(100));
    expect(local.getItem(KEY)).toBe(session(100));
    expect(await kv.get(`auth:${KEY}`)).toBe(session(100));
    await storage.removeItem(KEY);
    expect(local.getItem(KEY)).toBeNull();
    expect(await kv.get(`auth:${KEY}`)).toBeUndefined();
  });

  it('takes the newer session the service worker stored, and copies it to localStorage', async () => {
    const kv = createMemoryKv({ [`auth:${KEY}`]: session(200) });
    const local = memoryLocal({ [KEY]: session(100) });
    expect(await createSharedAuthStorage(kv, local).getItem(KEY)).toBe(session(200));
    expect(local.getItem(KEY)).toBe(session(200));
  });

  it('keeps the page session when it is newer or the copy is missing', async () => {
    const local = memoryLocal({ [KEY]: session(300) });
    const kv = createMemoryKv({ [`auth:${KEY}`]: session(200) });
    expect(await createSharedAuthStorage(kv, local).getItem(KEY)).toBe(session(300));
    // …and brings the copy up to date for the service worker.
    expect(await kv.get(`auth:${KEY}`)).toBe(session(300));
  });

  it('fills the copy for a session stored before the mirror existed', async () => {
    const kv = createMemoryKv();
    const local = memoryLocal({ [KEY]: session(300) });
    expect(await createSharedAuthStorage(kv, local).getItem(KEY)).toBe(session(300));
    expect(await kv.get(`auth:${KEY}`)).toBe(session(300));
  });

  it('uses the copy when only the service worker has a session (anonymous sign-in offline)', async () => {
    const kv = createMemoryKv({ [`auth:${KEY}`]: session(200) });
    expect(await createSharedAuthStorage(kv, memoryLocal()).getItem(KEY)).toBe(session(200));
  });

  it('works without localStorage (service worker) and without IndexedDB', async () => {
    const kv = createMemoryKv();
    const sw = createSharedAuthStorage(kv, null);
    await sw.setItem(KEY, session(1));
    expect(await sw.getItem(KEY)).toBe(session(1));
    const pageOnly = createSharedAuthStorage(null, memoryLocal());
    await pageOnly.setItem(KEY, session(2));
    expect(await pageOnly.getItem(KEY)).toBe(session(2));
  });

  it('a failing IndexedDB never breaks the page', async () => {
    const broken = {
      get: () => Promise.reject(new Error('blocked')),
      set: () => Promise.reject(new Error('blocked')),
      delete: () => Promise.reject(new Error('blocked')),
    };
    const local = memoryLocal();
    const storage = createSharedAuthStorage(broken, local);
    await storage.setItem(KEY, session(5));
    expect(await storage.getItem(KEY)).toBe(session(5));
    await storage.removeItem(KEY);
    expect(await storage.getItem(KEY)).toBeNull();
  });
});
