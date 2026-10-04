// Orders the day's pickup stops into a short route. Straight-line (great-circle) distances: good
// enough to order a few dozen stops in one district without a routing service; the actual
// driving route comes from the routing site the staff opens (routeUrl).
import { distanceMeters } from '@/features/map/reports';

export interface Point {
  lng: number;
  lat: number;
}

export interface Plan<T extends Point> {
  stops: T[];
  /** Distance of each leg in metres: legs[0] is start → first stop (0 without a start). */
  legs: number[];
  totalM: number;
}

/**
 * Nearest-neighbour routes from every possible first stop; the ten shortest are improved with
 * 2-opt and Or-opt moves until none helps, the best one wins. Open path: the route ends at the
 * last stop. Within a few percent of the optimum for a day's stops (see route.test.ts).
 */
export function planRoute<T extends Point>(stops: T[], start?: Point | null): Plan<T> {
  if (stops.length === 0) return { stops: [], legs: [], totalM: 0 };
  // Node 0 is the start when given; stops follow.
  const nodes: Point[] = start ? [start, ...stops] : stops;
  const n = nodes.length;
  const d = nodes.map((a) => nodes.map((b) => distanceMeters(a, b)));
  const length = (path: number[]) => path.slice(1).reduce((sum, v, i) => sum + d[path[i]!]![v]!, 0);

  /** Nearest neighbour from `prefix` (the start and/or the first stop). */
  const nearest = (prefix: number[]) => {
    const path = [...prefix];
    const left = new Set([...nodes.keys()].filter((k) => !prefix.includes(k)));
    while (left.size) {
      const last = path.at(-1)!;
      let best = -1;
      for (const c of left) if (best < 0 || d[last]![c]! < d[last]![best]!) best = c;
      path.push(best);
      left.delete(best);
    }
    return path;
  };

  // Local improvements until neither helps; with a start, node 0 stays first.
  const from = start ? 1 : 0;
  const dist = (u?: number, v?: number) => (u === undefined || v === undefined ? 0 : d[u]![v]!);
  const improve = (initial: number[]) => {
    let path = initial;
    const twoOpt = () => {
      let changed = false;
      for (let i = from; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          const delta =
            dist(path[i - 1], path[j]) +
            dist(path[i], path[j + 1]) -
            dist(path[i - 1], path[i]) -
            dist(path[j], path[j + 1]);
          if (delta < -1e-6) {
            path = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
            changed = true;
          }
        }
      }
      return changed;
    };
    // Or-opt: move a chain of 1–3 stops elsewhere (also reversed); gains computed in O(1).
    const orOpt = () => {
      for (let len = 1; len <= 3; len++) {
        for (let i = from; i + len <= n; i++) {
          const chain = path.slice(i, i + len);
          const [first, last] = [chain[0]!, chain.at(-1)!];
          const gain =
            dist(path[i - 1], first) + dist(last, path[i + len]) - dist(path[i - 1], path[i + len]);
          const rest = [...path.slice(0, i), ...path.slice(i + len)];
          for (let k = from; k <= rest.length; k++) {
            if (k === i) continue;
            const [p, q] = [rest[k - 1], rest[k]];
            for (const reversed of [false, true]) {
              const [x, y] = reversed ? [last, first] : [first, last];
              if (dist(p, x) + dist(y, q) - dist(p, q) - gain < -1e-6) {
                const piece = reversed ? [...chain].reverse() : chain;
                path = [...rest.slice(0, k), ...piece, ...rest.slice(k)];
                return true;
              }
            }
          }
        }
      }
      return false;
    };
    while (twoOpt() || orOpt());
    return path;
  };

  // Several starting routes (every possible first stop), the most promising ones improved.
  const seeds = [...nodes.keys()]
    .filter((k) => k >= from)
    .map((k) => nearest(start ? [0, k] : [k]))
    .sort((a, b) => length(a) - length(b))
    .slice(0, 10);
  const path = seeds.map(improve).reduce((a, b) => (length(b) < length(a) ? b : a));

  const order = start ? path.slice(1) : path;
  const legs = order.map((node, k) => {
    const prev = k === 0 ? (start ? 0 : null) : order[k - 1]!;
    return prev === null ? 0 : d[prev]![node]!;
  });
  return {
    stops: order.map((node) => stops[start ? node - 1 : node]!),
    legs,
    totalM: legs.reduce((a, b) => a + b, 0),
  };
}

/**
 * The route on routing.openstreetmap.de (FOSSGIS, OSM data; car profile), which plans the
 * actual roads between the stops in this order.
 */
export function routeUrl(points: Point[]): string {
  const loc = points.map((p) => `loc=${p.lat.toFixed(6)}%2C${p.lng.toFixed(6)}`).join('&');
  return `https://routing.openstreetmap.de/?${loc}&srv=0`;
}
