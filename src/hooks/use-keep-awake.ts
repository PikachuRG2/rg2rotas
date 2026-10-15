import { useEffect } from "react";

type WakeLockSentinelLike = {
  released: boolean;
  addEventListener: (type: "release", listener: () => void) => void;
  release: () => Promise<void>;
};

/**
 * Keeps the screen on while `enabled` is true and the page is visible.
 * Uses the Screen Wake Lock API; silently does nothing when unsupported.
 * The browser releases the lock when the tab goes to the background, so we
 * re-acquire when the app comes back to the foreground.
 */
export function useKeepAwake(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const wakeLock = (navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    }).wakeLock;
    if (!wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;

    const acquire = async () => {
      if (disposed || sentinel || document.visibilityState !== "visible") return;
      try {
        const lock = await wakeLock.request("screen");
        if (disposed) {
          void lock.release().catch(() => {});
          return;
        }
        lock.addEventListener("release", () => {
          sentinel = null;
        });
        sentinel = lock;
      } catch {
        // Denied or temporarily unavailable — the app stays usable without it.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}
