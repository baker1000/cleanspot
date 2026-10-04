import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/features/auth/useAuth';
import type { ReportDraft } from '../api';
import { useReportSubmitApi } from '../ReportSubmitApiContext';
import {
  createMemoryStore,
  defaultOutboxStore,
  type OutboxEntry,
  type OutboxError,
  type OutboxStore,
} from './store';
import { processEntry, syncOutbox, type SyncDeps } from './sync';

export type SendOutcome =
  /** Reached the server. */
  | { kind: 'sent'; reportId: string }
  /** Saved on this device; sent automatically later. */
  | { kind: 'queued'; reason: OutboxError }
  /** Not saved: the server refused it, or there is no storage to queue it in. */
  | { kind: 'error'; reason: OutboxError };

export interface OutboxValue {
  /** Reports saved on this device that have not reached the server yet. */
  entries: OutboxEntry[];
  syncing: boolean;
  /** Saved reports sent by the background sync since the notice was last dismissed. */
  sentInBackground: number;
  send(draft: ReportDraft): Promise<SendOutcome>;
  /** Tries all pending reports now, ignoring their retry schedule. */
  syncNow(): void;
  discard(id: string): Promise<void>;
  dismissSent(): void;
}

const OutboxContext = createContext<OutboxValue | null>(null);

/** Keeps a timer from firing in a tight loop if the clock and the schedule disagree. */
const MIN_TIMER_MS = 1000;
const LOCK_NAME = 'cleanspot-outbox';

export function OutboxProvider({
  store: storeProp,
  children,
}: {
  /** Inject for tests; `null` = no queue (reports are only sent directly). */
  store?: OutboxStore | null;
  children: ReactNode;
}) {
  const api = useReportSubmitApi();
  const { ensureSession, status } = useAuth();
  const [store] = useState(() =>
    storeProp !== undefined ? storeProp : api ? defaultOutboxStore() : null,
  );
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [sentInBackground, setSentInBackground] = useState(0);

  const ensureSessionRef = useRef(ensureSession);
  useEffect(() => {
    ensureSessionRef.current = ensureSession;
  }, [ensureSession]);

  // Store work runs one job at a time, across tabs too where Web Locks exist, so the background
  // sync and a report sent from the form never handle the same entry at the same time.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const exclusive = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = () => ('locks' in navigator ? navigator.locks.request(LOCK_NAME, job) : job());
    const next = chain.current.then(run, run);
    chain.current = next.catch(() => {});
    return next;
  }, []);

  const deps = useCallback(
    (): SyncDeps | null =>
      api && { api, getUserId: async () => (await ensureSessionRef.current()).user.id },
    [api],
  );

  // Re-reads the queue for the UI and plans the next background attempt.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const reload = useCallback(async () => {
    if (!store) return;
    const list = await store.list().catch(() => [] as OutboxEntry[]);
    setEntries(list);
    clearTimeout(timer.current);
    const due = list.filter((e) => e.state === 'pending').map((e) => e.nextAttemptAt);
    if (due.length) {
      const wait = Math.max(MIN_TIMER_MS, Math.min(...due) - Date.now());
      timer.current = setTimeout(() => void syncRef.current(), wait);
    }
  }, [store]);

  const sync = useCallback(
    async (force = false) => {
      const d = deps();
      if (!store || !d) return;
      try {
        const { sent } = await exclusive(() => {
          setSyncing(true);
          return syncOutbox(store, d, { force });
        });
        if (sent.length) setSentInBackground((n) => n + sent.length);
      } catch {
        // Storage not readable: nothing to send.
      } finally {
        setSyncing(false);
        await reload();
      }
    },
    [deps, exclusive, reload, store],
  );
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  // Show what is waiting right away; start sending once the session state is known (otherwise a
  // stored session could be missed and a new anonymous user created).
  // (reload and sync set state only after awaiting the store, never synchronously.)
  useEffect(() => {
    void reload(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [reload]);
  useEffect(() => {
    if (!store || !api || status !== 'ready') return;
    // Opening the app is a good moment to try everything, whatever the retry schedule says.
    void sync(true); // eslint-disable-line react-hooks/set-state-in-effect
    const onOnline = () => void sync(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer.current);
    };
  }, [api, status, store, sync]);

  const send = useCallback(
    async (draft: ReportDraft): Promise<SendOutcome> => {
      const d = deps();
      if (!d) return { kind: 'error', reason: 'server' };
      const now = Date.now();
      const entry: OutboxEntry = {
        id: draft.clientId,
        draft,
        state: 'pending',
        attempts: 0,
        lastError: null,
        nextAttemptAt: now,
        createdAt: now,
      };

      // Saving and the first attempt are one job, so the background sync cannot pick the entry
      // up in between (and count it as sent in the background).
      const job = async () => {
        let target = store;
        if (target) {
          try {
            await target.put(entry);
          } catch {
            target = null; // e.g. storage full or blocked: send directly, as without a queue
          }
        }
        const result = await processEntry(target ?? createMemoryStore([entry]), entry, d);
        // A refused report goes back to the form, where the user can correct it.
        if (result.kind === 'failed' && target) await target.delete(entry.id);
        return { result, queued: target !== null };
      };

      setSyncing(true);
      try {
        const { result, queued } = await exclusive(job);
        if (result.kind === 'sent') return result;
        if (result.kind === 'retry' && queued) return { kind: 'queued', reason: result.reason };
        return { kind: 'error', reason: result.reason };
      } finally {
        setSyncing(false);
        await reload();
      }
    },
    [deps, exclusive, reload, store],
  );

  const discard = useCallback(
    async (id: string) => {
      if (!store) return;
      await exclusive(() => store.delete(id)).catch(() => {});
      await reload();
    },
    [exclusive, reload, store],
  );

  const value: OutboxValue = {
    entries,
    syncing,
    sentInBackground,
    send,
    syncNow: () => void sync(true),
    discard,
    dismissSent: () => setSentInBackground(0),
  };
  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): OutboxValue {
  const value = useContext(OutboxContext);
  if (!value) throw new Error('useOutbox must be used inside <OutboxProvider>');
  return value;
}
