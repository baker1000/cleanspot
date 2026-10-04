export interface RateGate {
  /** Resolves when the caller may start its request. Calls are served in order. */
  wait(signal?: AbortSignal): Promise<void>;
}

const abortError = () => new DOMException('Aborted', 'AbortError');

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Guarantees at least `minIntervalMs` between the starts of two requests, across every caller
 * that shares the gate. An aborted waiter gives up its slot without delaying the others.
 */
export function createRateGate(minIntervalMs: number, now: () => number = Date.now): RateGate {
  let nextFree = 0;
  let queue: Promise<void> = Promise.resolve();

  return {
    wait(signal) {
      const turn = queue.then(async () => {
        if (signal?.aborted) throw abortError();
        const delay = nextFree - now();
        if (delay > 0) await sleep(delay, signal);
        nextFree = now() + minIntervalMs;
      });
      // The next caller waits for this turn to finish, whether it succeeded or was aborted.
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}
