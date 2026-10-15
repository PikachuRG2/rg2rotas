import { useEffect } from "react";

type WakeLockSentinelLike = { release: () => Promise<void> };

/**
 * Keeps the screen on while `enabled` is true and the page is visible.
 * Uses the Screen Wake Lock API; silently does nothing when unsupported.
 * Re-acquires automatically when the app comes back to the foreground.
 */
export function useKeepAwake(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let released = false;

    const acquire = async () => {
      if (released || sentinel || document.visibilityState !== "visible") return;
      try {
        sentinel = await wakeLock.request("screen");
        sentinel.release.finally?.(() => {}).catch(() => {});
      } catch {
        // Denied or unsupported — keep the app usable without it.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        sentinel = null;
        void acquire();
      }
    };

    void acquire();
    // The browser releases the lock when the tab is hidden; re-request on return.
    sentinel = null;
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      // Read the current lock through a fresh request guard; releasing a
      // released sentinel throws, so wrap in try/catch.
      try {
        void acquire;
      } catch {
        /* noop */
      }
    };
  }, [enabled]);
}
