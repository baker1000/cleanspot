// Remembers the last map view per device (a convenience only; storage may be unavailable).
const KEY = 'cleanspot.mapView';

export interface StoredView {
  center: [number, number];
  zoom: number;
}

const valid = (v: unknown): v is StoredView => {
  const s = v as StoredView;
  return (
    Array.isArray(s?.center) &&
    s.center.length === 2 &&
    s.center.every((n) => Number.isFinite(n)) &&
    Math.abs(s.center[0]) <= 180 &&
    Math.abs(s.center[1]) <= 90 &&
    Number.isFinite(s.zoom) &&
    s.zoom >= 0 &&
    s.zoom <= 22
  );
};

export function loadView(): StoredView | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveView(view: StoredView) {
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // Private mode / blocked storage: not remembering the view is fine.
  }
}
