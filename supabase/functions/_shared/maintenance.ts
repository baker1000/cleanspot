/**
 * Maintenance logic shared by the `maintenance` Edge Function.
 * Kept free of Deno/npm imports so it can be unit-tested with Vitest.
 */

export interface MaintenanceClient {
  /** Calls public.expire_stale_claims(); returns the number of released claims. */
  expireClaims(): Promise<number>;
  /** Calls public.orphan_photo_paths(); returns object paths in the report-photos bucket. */
  orphanPaths(limit: number): Promise<string[]>;
  /** Deletes files through the Storage API. */
  removeFiles(paths: string[]): Promise<void>;
}

export interface MaintenanceResult {
  expiredClaims: number;
  removedOrphans: number;
}

export const ORPHAN_BATCH = 500;
export const MAX_ROUNDS = 10;

export async function runMaintenance(client: MaintenanceClient): Promise<MaintenanceResult> {
  const expiredClaims = await client.expireClaims();

  let removedOrphans = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const paths = await client.orphanPaths(ORPHAN_BATCH);
    if (paths.length === 0) break;
    await client.removeFiles(paths);
    removedOrphans += paths.length;
    if (paths.length < ORPHAN_BATCH) break;
  }

  return { expiredClaims, removedOrphans };
}

/** Constant-time comparison of the shared secret header. Rejects when no secret is configured. */
export function isAuthorized(provided: string | null, secret: string | undefined): boolean {
  if (!secret || !provided) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
