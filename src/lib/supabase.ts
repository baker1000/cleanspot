import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSharedAuthStorage } from './authStorage';
import { parseEnv } from './env';
import { defaultKv } from './idb';

let client: SupabaseClient | undefined;

const pageStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Lazily created so tests and the landing page don't require Supabase env vars. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const env = parseEnv(import.meta.env);
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Mirrored into IndexedDB for the service worker (Background Sync of the offline queue).
        storage: createSharedAuthStorage(defaultKv(), pageStorage()),
      },
    });
  }
  return client;
}
