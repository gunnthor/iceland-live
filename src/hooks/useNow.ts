"use client";

import { useEffect, useState } from "react";

/**
 * A clock that ticks, seeded from a server-supplied instant.
 *
 * Relative labels ("4 min ago") cannot be rendered on the server and the client
 * from the same clock, so the first client render deliberately reuses the
 * server's instant and only starts ticking afterwards. Without that, the first
 * paint would differ from the server HTML and React would flag a hydration
 * mismatch on every timestamp in the interface.
 *
 * The first correction is scheduled rather than run inside the effect body, so
 * it lands after the first paint instead of forcing a synchronous second render
 * before anything reaches the screen.
 */
export function useNow(seedMs: number, intervalMs = 15_000): number {
  const [now, setNow] = useState(seedMs);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = setTimeout(update, 0);
    const ticker = setInterval(update, intervalMs);
    return () => {
      clearTimeout(initial);
      clearInterval(ticker);
    };
  }, [intervalMs]);

  return now;
}
