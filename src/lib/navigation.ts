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