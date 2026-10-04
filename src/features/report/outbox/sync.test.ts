import { describe, expect, it, vi } from 'vitest';
import { SubmitError, type ReportDraft, type ReportSubmitApi } from '../api';
import { createMemoryStore, type OutboxEntry } from './store';
import {
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  RATE_LIMIT_DELAY_MS,
  retryDelay,
  syncOutbox,
  type SyncDeps,
} from './sync';

const NOW = 1_800_000_000_000;
const UID = '00000000-0000-4000-8000-0000000000aa';

const draft = (clientId: string): ReportDraft => ({
  clientId,
  lng: 10.11,
  lat: 53.38,
  accuracyM: 9,
  category: 'mixed',
  hazardType: null,
  size: 'bag',
  comment: '',
  photos: [{ id: `p-${clientId}`, blob: new Blob(['x']), ext: 'webp' }],
  takenAt: '2026-10-04T10:00:00.000Z',
});

const entry = (id: string, over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id,
  draft: draft(id),
  state: 'pending',
  attempts: 0,
  lastError: null,
  nextAttemptAt: NOW,
  createdAt: NOW - 1000,
  ...over,
});

function deps(submit: ReportSubmitApi['submit'], getUserId = vi.fn(async () => UID)) {
  const api: ReportSubmitApi = {
    tenantAt: vi.fn(async () => null),
    nearby: vi.fn(async () => []),
    submit: vi.fn(submit),
  };
  return { api, getUserId, now: () => NOW } satisfies SyncDeps;
}

describe('retryDelay', () => {
  it('doubles from 30 s up to 30 min; rate limits wait at least 15 min', () => {
    expect([1, 2, 3, 4].map((n) => retryDelay(n, 'network'))).toEqual([
      BASE_DELAY_MS,
      2 * BASE_DELAY_MS,
      4 * BASE_DELAY_MS,
      8 * BASE_DELAY_MS,
    ]);
    expect(retryDelay(50, 'server')).toBe(MAX_DELAY_MS);
    expect(retryDelay(1, 'rate_limited')).toBe(RATE_LIMIT_DELAY_MS);
    expect(retryDelay(20, 'rate_limited')).toBe(MAX_DELAY_MS);
  });
});

describe('syncOutbox', () => {
  it('sends due entries oldest first, with the stored draft, and removes them', async () => {
    const store = createMemoryStore([
      entry('b', { createdAt: NOW - 10 }),
      entry('a', { createdAt: NOW - 20 }),
    ]);
    const d = deps(async (dr) => `report-${dr.clientId}`);
    const result = await syncOutbox(store, d);
    expect(result).toEqual({
      sent: [
        { id: 'a', reportId: 'report-a' },
        { id: 'b', reportId: 'report-b' },
      ],
      remaining: false,
    });
    expect(vi.mocked(d.api.submit).mock.calls.map(([dr, uid]) => [dr.clientId, uid])).toEqual([
      ['a', UID],
      ['b', UID],
    ]);
    expect(vi.mocked(d.api.submit).mock.calls[0]![0]).toEqual(draft('a'));
    expect(await store.list()).toEqual([]);
  });

  it('connection lost: keeps the entry, schedules a retry, and stops for now', async () => {
    const store = createMemoryStore([
      entry('a', { attempts: 2, createdAt: 1 }),
      entry('b', { createdAt: 2 }),
    ]);
    const d = deps(async () => {
      throw new SubmitError('network');
    });
    expect(await syncOutbox(store, d)).toEqual({ sent: [], remaining: true });
    expect(d.api.submit).toHaveBeenCalledOnce();
    const [a, b] = await store.list();
    expect(a).toMatchObject({
      state: 'pending',
      attempts: 3,
      lastError: 'network',
      nextAttemptAt: NOW + 4 * BASE_DELAY_MS,
    });
    expect(b).toEqual(entry('b', { createdAt: 2 }));
  });

  it('no session possible: treated like offline', async () => {
    const store = createMemoryStore([entry('a')]);
    const d = deps(
      async () => 'never',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await syncOutbox(store, d);
    expect(d.api.submit).not.toHaveBeenCalled();
    expect((await store.list())[0]).toMatchObject({ lastError: 'session', attempts: 1 });
  });

  it('server error or rate limit: retries later but goes on with the next entry', async () => {
    const store = createMemoryStore([
      entry('a', { createdAt: 1 }),
      entry('b', { createdAt: 2 }),
      entry('c', { createdAt: 3 }),
    ]);
    const d = deps(async (dr) => {
      if (dr.clientId === 'a') throw new SubmitError('server');
      if (dr.clientId === 'b') throw new SubmitError('rate_limited');
      return 'report-c';
    });
    const result = await syncOutbox(store, d);
    expect(result).toEqual({ sent: [{ id: 'c', reportId: 'report-c' }], remaining: true });
    const [a, b] = await store.list();
    expect(a).toMatchObject({ lastError: 'server', nextAttemptAt: NOW + BASE_DELAY_MS });
    expect(b).toMatchObject({
      lastError: 'rate_limited',
      nextAttemptAt: NOW + RATE_LIMIT_DELAY_MS,
    });
  });

  it('refused by the server: marks it failed and never retries it on its own', async () => {
    const store = createMemoryStore([entry('a')]);
    const d = deps(async () => {
      throw new SubmitError('invalid');
    });
    await syncOutbox(store, d);
    expect((await store.list())[0]).toMatchObject({ state: 'failed', lastError: 'invalid' });
    await syncOutbox(store, d, { force: true });
    expect(d.api.submit).toHaveBeenCalledOnce();
  });

  it('unexpected errors count as server errors', async () => {
    const store = createMemoryStore([entry('a')]);
    await syncOutbox(
      store,
      deps(async () => {
        throw new Error('boom');
      }),
    );
    expect((await store.list())[0]).toMatchObject({ state: 'pending', lastError: 'server' });
  });

  it('skips entries that are not due, unless forced (e.g. back online)', async () => {
    const store = createMemoryStore([entry('a', { nextAttemptAt: NOW + 60_000 })]);
    const d = deps(async () => 'report-a');
    expect(await syncOutbox(store, d)).toEqual({ sent: [], remaining: true });
    expect(d.api.submit).not.toHaveBeenCalled();
    expect(await syncOutbox(store, d, { force: true })).toEqual({
      sent: [{ id: 'a', reportId: 'report-a' }],
      remaining: false,
    });
  });
});
