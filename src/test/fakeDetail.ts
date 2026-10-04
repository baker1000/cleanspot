import { vi, type Mock } from 'vitest';
import type { DetailApi, ReportDetail, Viewer } from '@/features/detail/api';

export function detail(over: Partial<ReportDetail> = {}): ReportDetail {
  return {
    id: 'r0000000-0000-4000-8000-000000000001',
    tenantId: 't1',
    tenantName: 'Landkreis Harburg',
    tenantKind: 'municipality',
    lng: 10.1105,
    lat: 53.3842,
    status: 'reported',
    category: 'bulky',
    hazardType: null,
    isHazardous: false,
    size: 'pile',
    comment: null,
    isPublished: false,
    confirmationCount: 0,
    estimatedKg: 40,
    isClaimed: false,
    claimedByMe: false,
    reportedByMe: false,
    createdAt: '2026-10-01T10:00:00Z',
    clearedAt: null,
    cleanupRadiusM: 50,
    bagRadiusM: 300,
    maxBags: 30,
    pickups: [],
    photos: [],
    events: [],
    viewer: null,
    ...over,
  };
}

export const viewer = (over: Partial<Viewer> = {}): Viewer => ({
  confirmed: false,
  role: 'volunteer',
  publicTenantId: 'pub',
  ...over,
});

/** DetailApi with spies; load() returns the given report. */
export type FakeDetailApi = { [K in keyof DetailApi]: Mock<DetailApi[K]> };

export function fakeDetailApi(
  report: ReportDetail | null,
  over: Partial<FakeDetailApi> = {},
): FakeDetailApi {
  return {
    load: vi.fn<DetailApi['load']>(async () => report),
    confirm: vi.fn<DetailApi['confirm']>(async () => 1),
    claim: vi.fn<DetailApi['claim']>(async () => {}),
    unclaim: vi.fn<DetailApi['unclaim']>(async () => {}),
    joinAsVolunteer: vi.fn<DetailApi['joinAsVolunteer']>(async () => {}),
    submitCleanup: vi.fn<DetailApi['submitCleanup']>(async () => 12),
    reportBags: vi.fn<DetailApi['reportBags']>(async () => 'task-1'),
    cancelPickup: vi.fn<DetailApi['cancelPickup']>(async () => {}),
    ...over,
  };
}
