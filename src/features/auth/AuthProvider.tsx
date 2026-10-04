import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { hasBackendConfig } from '@/lib/env';
import { mapAuthError, type AuthErrorKey } from './authErrors';

export type AuthClient = Pick<
  SupabaseClient['auth'],
  | 'getSession'
  | 'onAuthStateChange'
  | 'signInAnonymously'
  | 'signInWithPassword'
  | 'signUp'
  | 'updateUser'
  | 'signOut'
>;

export type AuthStatus = 'loading' | 'ready' | 'unconfigured';

export type AuthResult =
  { ok: true; needsConfirmation?: boolean } | { ok: false; error: AuthErrorKey };

export interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  /** Signed in with an email account (not anonymous). */
  isRegistered: boolean;
  isAnonymous: boolean;
  /** Returns the current session, creating an anonymous one if needed (e.g. before reporting). */
  ensureSession(): Promise<Session>;
  signIn(email: string, password: string): Promise<AuthResult>;
  /** Creates an account. An anonymous session is upgraded in place, keeping its reports. */
  signUp(email: string, password: string): Promise<AuthResult>;
  /** `local`: only forget the session on this device (e.g. after the account was deleted). */
  signOut(opts?: { local?: boolean }): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Initial client: injected, `null` without config, or `undefined` = load supabase-js lazily. */
function initialClient(client: AuthClient | null | undefined): AuthClient | null | undefined {
  if (client !== undefined) return client;
  return hasBackendConfig(import.meta.env) ? undefined : null;
}

const fail = (error: AuthError | Error | null): AuthResult => ({
  ok: false,
  error: mapAuthError(error),
});

export function AuthProvider({
  client: clientProp,
  children,
}: {
  /** Inject for tests; `null` simulates a missing backend configuration. */
  client?: AuthClient | null;
  children: ReactNode;
}) {
  const [client, setClient] = useState(() => initialClient(clientProp));
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const status: AuthStatus =
    client === null ? 'unconfigured' : client && sessionLoaded ? 'ready' : 'loading';

  // supabase-js is code-split so the first paint doesn't wait for it.
  useEffect(() => {
    if (client !== undefined) return;
    let active = true;
    import('@/lib/supabase')
      .then((m) => active && setClient(m.getSupabase().auth))
      .catch(() => active && setClient(null));
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data } = client.onAuthStateChange((_event, next) => {
      if (active) setSession(next);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  // One sign-in at a time: callers in the same render (e.g. the offline queue sending several
  // reports) share it instead of each creating another anonymous user.
  const signingIn = useRef<Promise<Session> | null>(null);
  const ensureSession = useCallback(async () => {
    if (!client) throw new Error('Backend not configured');
    if (session) return session;
    signingIn.current ??= (async () => {
      // A session stored on the device may not be in state yet (e.g. right after page load).
      const stored = (await client.getSession()).data.session;
      if (stored) return stored;
      const { data, error } = await client.signInAnonymously();
      if (error || !data.session) throw error ?? new Error('Anonymous sign-in failed');
      return data.session;
    })()
      .then((next) => {
        setSession(next);
        return next;
      })
      .finally(() => {
        signingIn.current = null;
      });
    return signingIn.current;
  }, [client, session]);

  const signIn = useCallback<AuthContextValue['signIn']>(
    async (email, password) => {
      if (!client) return fail(null);
      const { error } = await client.signInWithPassword({ email, password });
      return error ? fail(error) : { ok: true };
    },
    [client],
  );

  const signUp = useCallback<AuthContextValue['signUp']>(
    async (email, password) => {
      if (!client) return fail(null);
      if (session?.user.is_anonymous) {
        const { data, error } = await client.updateUser({ email, password });
        if (error) return fail(error);
        return { ok: true, needsConfirmation: Boolean(data.user?.new_email) };
      }
      const { data, error } = await client.signUp({ email, password });
      if (error) return fail(error);
      return { ok: true, needsConfirmation: !data.session };
    },
    [client, session],
  );

  const signOut = useCallback<AuthContextValue['signOut']>(
    async (opts) => {
      if (!client) return;
      try {
        await client.signOut(opts?.local ? { scope: 'local' } : undefined);
      } finally {
        setSession(null);
      }
    },
    [client],
  );

  const value = useMemo<AuthContextValue>(() => {
    const isAnonymous = Boolean(session?.user.is_anonymous);
    return {
      status,
      session,
      isAnonymous,
      isRegistered: Boolean(session) && !isAnonymous,
      ensureSession,
      signIn,
      signUp,
      signOut,
    };
  }, [status, session, ensureSession, signIn, signUp, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
