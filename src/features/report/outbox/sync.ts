// Sends queued reports. Safe to run again at any time: submit() is idempotent per client id, so a
// report whose response got lost is not created twice.
import { SubmitError, type ReportSubmitApi } from '../api';
import type { OutboxEntry, OutboxError, OutboxStore } from './store';

/** Worth trying again later. Everything else means the server refused the report as it is. */
const RETRYABLE = new Set<OutboxError>(['network', 'session', 'server', 'rate_limited']);
/** No connection: trying the next entry right away would fail the same way. */
const OFFLINE = new Set<OutboxError>(['network', 'session']);

export const BASE_DELAY_MS = 30_000;
export const MAX_DELAY_MS = 30 * 60_000;
/** The server limit counts reports per hour; retrying sooner only fails again. */
export const RATE_LIMIT_DELAY_MS = 15 * 60_000;

/** 30 s, 1 min, 2 min, … up to 30 min. */
export function retryDelay(attempts: number, reason: OutboxError): number {
  const delay = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
  return reason === 'rate_limited' ? Math.max(delay, RATE_LIMIT_DELAY_MS) : delay;
}

export type AttemptResult =
  | { kind: 'sent'; reportId: string }
  | { kind: 'retry'; reason: OutboxError }
  | { kind: 'failed'; reason: OutboxError };

export interface SyncDeps {
  api: ReportSubmitApi;
  /** Signs in anonymously if needed; throws without connection. */
  getUserId: () => Promise<string>;
  now?: () => number;
}

/** One attempt for one entry; updates the store accordingly. */
export async function processEntry(
  store: OutboxStore,
  entry: OutboxEntry,
  deps: SyncDeps,
): Promise<AttemptResult> {
  const result = await attempt(entry, deps);
  if (result.kind === 'sent') {
    await store.delete(entry.id);
  } else {
    const attempts = entry.attempts + 1;
    const now = deps.now ?? Date.now;
    await store.put({
      ...entry,
      attempts,
      lastError: result.reason,
      state: result.kind === 'retry' ? 'pending' : 'failed',
      nextAttemptAt:
        result.kind === 'retry' ? now() + retryDelay(attempts, result.reason) : entry.nextAttemptAt,
    });
  }
  return result;
}

async function attempt(entry: OutboxEntry, { api, getUserId }: SyncDeps): Promise<AttemptResult> {
  let userId: string;
  try {
    userId = await getUserId();
  } catch {
    return { kind: 'retry', reason: 'session' };
  }
  try {
    return { kind: 'sent', reportId: await api.submit(entry.draft, userId) };
  } catch (error) {
    const reason: OutboxError = error instanceof SubmitError ? error.reason : 'server';
    return RETRYABLE.has(reason) ? { kind: 'retry', reason } : { kind: 'failed', reason };
  }
}

export interface SyncResult {
  sent: { id: string; reportId: string }[];
  /** True if an entry was skipped because it is not due yet or the device seems offline. */
  remaining: boolean;
}

/**
 * Sends all pending entries that are due (or all of them with `force`), oldest first. Stops at
 * the first connection problem; the remaining entries keep their schedule.
 */
export async function syncOutbox(
  store: OutboxStore,
  deps: SyncDeps,
  { force = false }: { force?: boolean } = {},
): Promise<SyncResult> {
  const now = deps.now ?? Date.now;
  const sent: SyncResult['sent'] = [];
  let remaining = false;
  for (const entry of await store.list()) {
    if (entry.state !== 'pending') continue;
    if (!force && entry.nextAttemptAt > now()) {
      remaining = true;
      continue;
    }
    const result = await processEntry(store, entry, deps);
    if (result.kind === 'sent') {
      sent.push({ id: entry.id, reportId: result.reportId });
    } else if (result.kind === 'retry') {
      remaining = true;
      if (OFFLINE.has(result.reason)) break;
    }
  }
  return { sent, remaining };
}
