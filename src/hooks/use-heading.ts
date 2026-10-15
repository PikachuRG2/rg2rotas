import { useEffect, useState } from "react";

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

/** Ask iOS for compass permission. Must run inside a user tap. */
export async function requestCompassPermission() {
  const DOE = (globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (DOE?.requestPermission) {
    try { await DOE.requestPermission(); } catch { /* ignore */ }
  }
}

/** Compass heading in degrees (0 = north, clockwise), smoothed. Null if unavailable. */
export function useHeading(enabled: boolean) {
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let last: number | null = null;
    const onOrient = (e: Event) => {
      const ev = e as IOSOrientationEvent;
      let h: number | null = null;
      if (typeof ev.webkitCompassHeading === "number") h = ev.webkitCompassHeading;
      else if (ev.absolute && typeof ev.alpha === "number") h = 360 - ev.alpha;
      if (h === null) return;
      const angle = window.screen.orientation?.angle ?? 0;
      h = (h + angle + 360) % 360;
      if (last !== null) {
        const diff = ((h - last + 540) % 360) - 180;
        if (Math.abs(diff) < 3) return;
        h = (last + diff * 0.35 + 360) % 360;
      }
      last = h;
      setHeading(h);
    };
    const evName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(evName, onOrient);
    return () => window.removeEventListener(evName, onOrient);
  }, [enabled]);
  return heading;
}
