import { describe, expect, it } from 'vitest';
import { distanceMeters } from '@/features/map/reports';
import { planRoute, routeUrl, type Point } from './route';

// ~111 m per 0.001° latitude; at 53.4° N ~66 m per 0.001° longitude.
const at = (id: string, dLng: number, dLat: number) => ({
  id,
  lng: 10 + dLng / 1000,
  lat: 53.4 + dLat / 1000,
});

const pathLength = (points: Point[]) =>
  points.slice(1).reduce((sum, p, i) => sum + distanceMeters(points[i]!, p), 0);

/** Shortest open path by trying every order (small inputs only). */
function bruteForce(points: Point[], start?: Point): number {
  let best = Infinity;
  const permute = (rest: Point[], acc: Point[]) => {
    if (!rest.length) {
      best = Math.min(best, pathLength(start ? [start, ...acc] : acc));
      return;
    }
    rest.forEach((p, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, p]));
  };
  permute(points, []);
  return best;
}

describe('planRoute', () => {
  it('empty and single stop', () => {
    expect(planRoute([])).toEqual({ stops: [], legs: [], totalM: 0 });
    const one = at('a', 0, 0);
    expect(planRoute([one])).toEqual({ stops: [one], legs: [0], totalM: 0 });
  });

  it('visits stops on a line in order, whatever order they come in', () => {
    const line = ['a', 'b', 'c', 'd', 'e'].map((id, i) => at(id, 0, i * 5));
    const shuffled = [line[3]!, line[0]!, line[4]!, line[1]!, line[2]!];
    const plan = planRoute(shuffled);
    const ids = plan.stops.map((s) => s.id).join('');
    expect(['abcde', 'edcba']).toContain(ids);
    expect(plan.totalM).toBeCloseTo(distanceMeters(line[0]!, line[4]!), 0);
  });

  it('starts at the nearest end when a start point is given', () => {
    const line = ['a', 'b', 'c'].map((id, i) => at(id, 0, i * 5));
    const plan = planRoute(line, at('depot', 0, 30));
    expect(plan.stops.map((s) => s.id)).toEqual(['c', 'b', 'a']);
    expect(plan.legs[0]).toBeCloseTo(distanceMeters(at('x', 0, 30), line[2]!), 0);
    expect(plan.legs).toHaveLength(3);
  });

  it('untangles a crossing (2-opt) and matches the optimum on small inputs', () => {
    // Deterministic pseudo-random scatter of 7 stops.
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 40;
    for (let run = 0; run < 5; run++) {
      const pts = Array.from({ length: 7 }, (_, i) => at(`s${i}`, rnd(), rnd()));
      const start = at('start', rnd(), rnd());
      const free = planRoute(pts);
      const fixed = planRoute(pts, start);
      // Heuristic: within 5 % of the true optimum on these small cases.
      expect(free.totalM).toBeLessThanOrEqual(bruteForce(pts) * 1.05);
      expect(fixed.totalM).toBeLessThanOrEqual(bruteForce(pts, start) * 1.05);
      expect(new Set(free.stops.map((s) => s.id)).size).toBe(7);
      expect(fixed.totalM).toBeCloseTo(pathLength([start, ...fixed.stops]), 3);
    }
  });

  it('stays fast for a full day (100 stops)', () => {
    const pts = Array.from({ length: 100 }, (_, i) => at(`s${i}`, (i * 37) % 97, (i * 53) % 89));
    const t0 = performance.now();
    const plan = planRoute(pts, at('start', 0, 0));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(plan.stops).toHaveLength(100);
  });
});

describe('routeUrl', () => {
  it('lists the stops in route order for the FOSSGIS router (car)', () => {
    expect(routeUrl([at('a', 0, 0), at('b', 1, 2)])).toBe(
      'https://routing.openstreetmap.de/?loc=53.400000%2C10.000000&loc=53.402000%2C10.001000&srv=0',
    );
  });
});
