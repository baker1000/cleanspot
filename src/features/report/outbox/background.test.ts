import { describe, expect, it, vi } from 'vitest';
import { createMemoryKv } from '@/lib/idb';
import { SubmitError, type ReportDraft, type ReportSubmitApi } from '../api';
import {
  createBrowserBackground,
  runBackgroundSync,
  SENT_WHILE_CLOSED_KEY,
  SYNC_MESSAGE,
  SYNC_TAG,
} from './background';
import { createMemoryStore, type OutboxEntry } from './store';

const entry = (id: string, createdAt = 1): OutboxEntry => ({
  id,
  draft: { clientId: id } as ReportDraft,
  state: 'pending',
  attempts: 0,
  lastError: null,
  // Not due yet: Background Sync sends anyway (the connection is back).
  nextAttemptAt: Date.now() + 60_000,
  createdAt,
});

const api = (submit: ReportSubmitApi['submit']): ReportSubmitApi => ({
  tenantAt: async () => null,
  nearby: async () => [],
  submit,
});
const noLock = <T>(job: () => Promise<T>) => job();

describe('runBackgroundSync (service worker)', () => {
  it('sends everything waiting and counts it for the next page', async () => {
    const store = createMemoryStore([entry('a', 1), entry('b', 2)]);
    const kv = createMemoryKv({ [SENT_WHILE_CLOSED_KEY]: 1 });
    const submit = vi.fn(async (d: ReportDraft) => `r-${d.clientId}`);
    const sent = await runBackgroundSync({
      store,
      kv,
      lock: noLock,
      deps: { api: api(submit), getUserId: async () => 'u1' },
    });
    expect(sent).toBe(2);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(await store.list()).toEqual([]);
    expect(await kv.get(SENT_WHILE_CLOSED_KEY)).toBe(3);
  });

  it('rejects while reports still wait, so the browser retries', async () => {
    const store = createMemoryStore([entry('a')]);
    await expect(
      runBackgroundSync({
        store,
        kv: createMemoryKv(),
        lock: noLock,
        deps: {
          api: api(async () => Promise.reject(new SubmitError('network'))),
          getUserId: async () => 'u1',
        },
      }),
    ).rejects.toThrow(/retry/);
    expect(await store.list()).toHaveLength(1);
  });

  it('a refused report is not retried by the browser (only the user can discard it)', async () => {
    const store = createMemoryStore([entry('a')]);
    await expect(
      runBackgroundSync({
        store,
        kv: createMemoryKv(),
        lock: noLock,
        deps: {
          api: api(async () => Promise.reject(new SubmitError('invalid'))),
          getUserId: async () => 'u1',
        },
      }),
    ).resolves.toBe(0);
    expect((await store.list())[0]).toMatchObject({ state: 'failed', lastError: 'invalid' });
  });
});

describe('createBrowserBackground (page)', () => {
  function fakeServiceWorker(reg: unknown) {
    const target = new EventTarget();
    const container = Object.assign(target, { getRegistration: vi.fn(async () => reg) });
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    return container;
  }
  const restore = () => Reflect.deleteProperty(navigator, 'serviceWorker');

  it('registers the sync tag with an active worker', async () => {
    const register = vi.fn(async () => {});
    fakeServiceWorker({ active: {}, sync: { register } });
    try {
      await createBrowserBackground(null).register();
      expect(register).toHaveBeenCalledWith(SYNC_TAG);
    } finally {
      restore();
    }
  });

  it('is a no-op without Background Sync or without a worker', async () => {
    fakeServiceWorker({ active: {} });
    try {
      await expect(createBrowserBackground(null).register()).resolves.toBeUndefined();
    } finally {
      restore();
    }
    await expect(createBrowserBackground(null).register()).resolves.toBeUndefined();
  });

  it('hears the worker asking to send', () => {
    const sw = fakeServiceWorker(undefined);
    try {
      const cb = vi.fn();
      const off = createBrowserBackground(null).onSyncRequest(cb);
      sw.dispatchEvent(new MessageEvent('message', { data: { type: 'other' } }));
      sw.dispatchEvent(new MessageEvent('message', { data: { type: SYNC_MESSAGE } }));
      off();
      sw.dispatchEvent(new MessageEvent('message', { data: { type: SYNC_MESSAGE } }));
      expect(cb).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });

  it('takes the count of reports sent while closed exactly once', async () => {
    const kv = createMemoryKv({ [SENT_WHILE_CLOSED_KEY]: 2 });
    const bg = createBrowserBackground(kv);
    const [a, b] = await Promise.all([bg.takeSentWhileClosed(), bg.takeSentWhileClosed()]);
    expect(a + b).toBe(2);
    expect(await bg.takeSentWhileClosed()).toBe(0);
  });
});
