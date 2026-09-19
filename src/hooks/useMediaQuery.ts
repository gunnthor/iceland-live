"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Tracks a media query.
 *
 * `useSyncExternalStore` rather than state-plus-effect: the match is external
 * state that React should read, not state React owns. That gets the value on
 * the first client render instead of after a second pass, and `getServerSnapshot`
 * makes the server's assumption explicit rather than implied by an initial
 * state value.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = useCallback(() => serverValue, [serverValue]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
