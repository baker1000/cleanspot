import type { Session, User } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { AuthClient } from '@/features/auth/AuthProvider';

export function fakeSession(opts: { anonymous?: boolean; email?: string } = {}): Session {
  const user = {
    id: '00000000-0000-4000-8000-0000000000aa',
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
    is_anonymous: opts.anonymous ?? false,
    email: opts.anonymous ? undefined : (opts.email ?? 'anna@example.org'),
  } as User;
  return {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user,
  } as Session;
}

type Listener = (event: string, session: Session | null) => void;

/** In-memory stand-in for supabase.auth with spies on every method. */
export function fakeAuthClient(initial: Session | null = null) {
  let session = initial;
  const listeners = new Set<Listener>();
  const emit = (event: string) => listeners.forEach((l) => l(event, session));
  const ok = () => ({ error: null });

  const client = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    }),
    signInAnonymously: vi.fn(async () => {
      session = fakeSession({ anonymous: true });
      emit('SIGNED_IN');
      return { data: { session, user: session.user }, error: null };
    }),
    signInWithPassword: vi.fn(async ({ email }: { email: string }) => {
      session = fakeSession({ email });
      emit('SIGNED_IN');
      return { data: { session, user: session.user }, ...ok() };
    }),
    signUp: vi.fn(async () => ({ data: { session: null, user: null }, ...ok() })),
    updateUser: vi.fn(async ({ email }: { email?: string }) => ({
      data: { user: { ...session!.user, new_email: email } },
      ...ok(),
    })),
    signOut: vi.fn(async () => {
      session = null;
      emit('SIGNED_OUT');
      return ok();
    }),
  };
  return client as typeof client & AuthClient;
}
