// @vitest-environment node
import {
  isAuthorized,
  MAX_ROUNDS,
  ORPHAN_BATCH,
  runMaintenance,
  type MaintenanceClient,
} from './maintenance.ts';

function fakeClient(orphanCount: number, expired = 2) {
  let remaining = Array.from({ length: orphanCount }, (_, i) => `u/${i}.webp`);
  const removed: string[][] = [];
  const client: MaintenanceClient = {
    expireClaims: async () => expired,
    orphanPaths: async (limit) => remaining.slice(0, limit),
    removeFiles: async (paths) => {
      removed.push(paths);
      remaining = remaining.filter((p) => !paths.includes(p));
    },
  };
  return { client, removed };
}

describe('runMaintenance', () => {
  it('expires claims and removes orphans in batches', async () => {
    const { client, removed } = fakeClient(ORPHAN_BATCH + 20);
    expect(await runMaintenance(client)).toEqual({
      expiredClaims: 2,
      removedOrphans: ORPHAN_BATCH + 20,
    });
    expect(removed.map((b) => b.length)).toEqual([ORPHAN_BATCH, 20]);
  });

  it('does not call removeFiles when there are no orphans', async () => {
    const { client, removed } = fakeClient(0, 0);
    expect(await runMaintenance(client)).toEqual({ expiredClaims: 0, removedOrphans: 0 });
    expect(removed).toHaveLength(0);
  });

  it('stops after a bounded number of rounds if deletion does not take effect', async () => {
    const client: MaintenanceClient = {
      expireClaims: async () => 0,
      orphanPaths: async (limit) => Array.from({ length: limit }, (_, i) => `x/${i}`),
      removeFiles: async () => undefined,
    };
    expect((await runMaintenance(client)).removedOrphans).toBe(ORPHAN_BATCH * MAX_ROUNDS);
  });
});

describe('isAuthorized', () => {
  it('accepts only the exact secret', () => {
    expect(isAuthorized('s3cret', 's3cret')).toBe(true);
    expect(isAuthorized('s3cre', 's3cret')).toBe(false);
    expect(isAuthorized('s3cretX', 's3cret')).toBe(false);
    expect(isAuthorized(null, 's3cret')).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    expect(isAuthorized('', undefined)).toBe(false);
    expect(isAuthorized('anything', '')).toBe(false);
  });
});
