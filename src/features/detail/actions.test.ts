import { describe, expect, it } from 'vitest';
import { availableActions, navigationLinks } from './actions';
import { detail, viewer } from '@/test/fakeDetail';
import { classifyActionError } from './api';

describe('availableActions', () => {
  it('visitors and anonymous users are pointed to an account', () => {
    expect(availableActions(detail(), false)).toEqual({
      confirm: 'needs_account',
      claim: 'needs_account',
      cleanup: false,
      bags: 'hidden',
    });
    // An anonymous session has a viewer, but still no account.
    expect(availableActions(detail({ viewer: viewer() }), false).claim).toBe('needs_account');
  });

  it('registered volunteers can confirm and claim open reports', () => {
    expect(availableActions(detail({ viewer: viewer() }), true)).toEqual({
      confirm: 'available',
      claim: 'available',
      cleanup: false,
      bags: 'hidden',
    });
    expect(availableActions(detail({ status: 'confirmed', viewer: viewer() }), true).claim).toBe(
      'available',
    );
  });

  it('own reports cannot be confirmed; a confirmation counts once', () => {
    expect(availableActions(detail({ reportedByMe: true, viewer: viewer() }), true).confirm).toBe(
      'own',
    );
    expect(availableActions(detail({ viewer: viewer({ confirmed: true }) }), true).confirm).toBe(
      'done',
    );
  });

  it('registered users without a membership are offered to join first', () => {
    expect(availableActions(detail({ viewer: viewer({ role: 'none' }) }), true).claim).toBe('join');
    expect(
      availableActions(detail({ viewer: viewer({ role: 'none', publicTenantId: null }) }), true)
        .claim,
    ).toBe('hidden');
  });

  it('hazardous waste: staff only', () => {
    const hazardous = { isHazardous: true, category: 'hazardous' as const };
    expect(availableActions(detail({ ...hazardous, viewer: viewer() }), true).claim).toBe(
      'hazardous',
    );
    expect(availableActions(detail(hazardous), false).claim).toBe('hazardous');
    expect(
      availableActions(detail({ ...hazardous, viewer: viewer({ role: 'staff' }) }), true).claim,
    ).toBe('available');
  });

  it('in progress: the claimer may clear or give back; others see it is taken', () => {
    const mine = availableActions(
      detail({ status: 'in_progress', isClaimed: true, claimedByMe: true, viewer: viewer() }),
      true,
    );
    expect(mine).toEqual({ confirm: 'hidden', claim: 'mine', cleanup: true, bags: 'hidden' });
    expect(availableActions(detail({ status: 'in_progress', isClaimed: true }), false).claim).toBe(
      'taken',
    );
  });

  it('cleared reports offer nothing', () => {
    expect(availableActions(detail({ status: 'cleared', viewer: viewer() }), true)).toEqual({
      confirm: 'hidden',
      claim: 'hidden',
      cleanup: false,
      bags: 'hidden',
    });
  });
});

describe('bags for pickup', () => {
  const cleared = { status: 'cleared' as const, isClaimed: true };
  it('the person who cleared it (or staff), where a municipality collects', () => {
    expect(
      availableActions(detail({ ...cleared, claimedByMe: true, viewer: viewer() }), true).bags,
    ).toBe('available');
    expect(
      availableActions(detail({ ...cleared, viewer: viewer({ role: 'staff' }) }), true).bags,
    ).toBe('available');
  });
  it('nobody collects in the public area', () => {
    expect(
      availableActions(
        detail({ ...cleared, claimedByMe: true, tenantKind: 'public', viewer: viewer() }),
        true,
      ).bags,
    ).toBe('no_service');
  });
  it('others, visitors and open reports: hidden', () => {
    expect(availableActions(detail({ ...cleared, viewer: viewer() }), true).bags).toBe('hidden');
    expect(availableActions(detail({ ...cleared, claimedByMe: true }), false).bags).toBe('hidden');
    expect(availableActions(detail({ claimedByMe: true, viewer: viewer() }), true).bags).toBe(
      'hidden',
    );
  });
});

describe('navigationLinks', () => {
  it('builds an OpenStreetMap route and a geo: link to the report', () => {
    expect(navigationLinks({ lat: 53.3842, lng: 10.1105 })).toEqual({
      web: 'https://www.openstreetmap.org/directions?route=%3B53.384200%2C10.110500#map=17/53.38420/10.11050',
      app: 'geo:53.384200,10.110500?q=53.384200,10.110500',
    });
  });
});

describe('classifyActionError', () => {
  it.each([
    ['CS001', 'status'],
    ['CS003', 'claimed'],
    ['CS004', 'hazardous'],
    ['CS008', 'account'],
    ['CS009', 'account'],
    ['42501', 'not_allowed'],
    ['PT429', 'rate_limited'],
    ['CS006', 'photo'],
    ['CS010', 'no_pickup'],
  ])('%s is %s', (code, reason) => {
    expect(classifyActionError({ code, message: 'x' }).reason).toBe(reason);
  });

  it('reads distance and radius from the "too far" message', () => {
    const e = classifyActionError({
      code: 'CS002',
      message: 'After-photo was taken 73 m from the report (max 50 m)',
    });
    expect(e.reason).toBe('too_far');
    expect(e.distance).toEqual({ meters: 73, maxMeters: 50 });
  });

  it('network failures', () => {
    expect(classifyActionError(new TypeError('Failed to fetch')).reason).toBe('network');
  });
});
