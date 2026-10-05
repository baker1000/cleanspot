// Where supabase-js keeps the session. The page uses localStorage as before, and every write is
// mirrored into IndexedDB, because the service worker (Background Sync for the offline queue)
// cannot read localStorage. The service worker uses the IndexedDB copy alone; when it refreshes
// the session or signs in anonymously, the page picks the newer copy up on its next read.
import type { KeyValueStore } from './idb';

/** The part of `Storage` used here (localStorage in the page). */
export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AsyncAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const kvKey = (key: string) => `auth:${key}`;

/** `expires_at` of a stored session; 0 for anything else (e.g. a PKCE code verifier). */
function expiresAt(value: string): number {
  try {
    const parsed = JSON.parse(value) as { expires_at?: unknown };
    return typeof parsed.expires_at === 'number' ? parsed.expires_at : 0;
  } catch {
    return 0;
  }
}

const attempt = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export function createSharedAuthStorage(
  kv: KeyValueStore | null,
  local: SyncStorage | null,
): AsyncAuthStorage {
  return {
    async getItem(key) {
      const fromLocal = local ? attempt(() => local.getItem(key), null) : null;
      const fromKv = kv
        ? ((await kv.get<string>(kvKey(key)).catch(() => undefined)) ?? null)
        : null;
      if (fromLocal !== null && (fromKv === null || expiresAt(fromKv) <= expiresAt(fromLocal))) {
        // Also fills the copy for sessions stored before the mirror existed; otherwise the
        // service worker would send a signed-in user's reports as a new anonymous user.
        if (fromKv !== fromLocal) await kv?.set(kvKey(key), fromLocal).catch(() => {});
        return fromLocal;
      }
      if (fromKv === null) return null;
      // The service worker stored a newer session (or the only one): use it here too.
      if (local) attempt(() => local.setItem(key, fromKv), undefined);
      return fromKv;
    },
    async setItem(key, value) {
      if (local) attempt(() => local.setItem(key, value), undefined);
      await kv?.set(kvKey(key), value).catch(() => {});
    },
    async removeItem(key) {
      if (local) attempt(() => local.removeItem(key), undefined);
      await kv?.delete(kvKey(key)).catch(() => {});
    },
  };
}
