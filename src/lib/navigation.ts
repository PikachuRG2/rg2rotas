export type NavigationPoint = { lat: number; lng: number };
export type NavigationStep = {
  instruction: string;
  maneuver: string;
  distanceMeters: number;
  start: NavigationPoint;
  end: NavigationPoint;
};
export type NavigationPlan = { distanceMeters: number; durationSeconds: number; steps: NavigationStep[] };

export function distanceBetween(a: NavigationPoint, b: NavigationPoint) {
  const radians = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * radians / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin((b.lng - a.lng) * radians / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Advance only at the current step's endpoint; never skip ahead at a crossing.
export function advanceStep(steps: NavigationStep[], current: number, position: NavigationPoint) {
  const step = steps[current];
  return step && distanceBetween(position, step.end) <= 25 ? current + 1 : current;
}

export function navigationDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** Distance to the actual route segments, not just its vertices. */
export function distanceToPath(position: NavigationPoint, path: NavigationPoint[]) {
  const scale = Math.PI * 6371000 / 180;
  const longitudeScale = scale * Math.cos(position.lat * Math.PI / 180);
  let nearest = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (!a || !b) continue;
    const ax = (a.lng - position.lng) * longitudeScale, ay = (a.lat - position.lat) * scale;
    const dx = (b.lng - a.lng) * longitudeScale, dy = (b.lat - a.lat) * scale;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return nearest;
}

export function offRouteFixes(position: NavigationPoint, path: NavigationPoint[], previous: number) {
  return path.length >= 2 && distanceToPath(position, path) > 50 ? previous + 1 : 0;
}

export function shouldRecalculate(fixes: number, now: number, lastAttempt: number, pending: boolean) {
  return !pending && fixes >= 3 && now - lastAttempt >= 15000;
}