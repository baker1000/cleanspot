import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseEnv } from './env';

let client: SupabaseClient | undefined;

/** Lazily created so tests and the landing page don't require Supabase env vars. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const env = parseEnv(import.meta.env);
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
