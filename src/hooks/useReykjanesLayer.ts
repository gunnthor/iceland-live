"use client";

import { useEffect, useRef, useState } from "react";
import type { ReykjanesResult } from "@/domain/api";
import type { ReykjanesLayer } from "@/domain/reykjanes";

export type ReykjanesState = {
  layer: ReykjanesLayer | null;
  unavailable: boolean;
  /**
   * True between switching the layer on and the geometry arriving.
   *
   * Derived rather than stored: "enabled, nothing yet, no failure" is exactly
   * what loading means here, and deriving it avoids a state flag whose only
   * job is to be kept in sync with the other two.
   */
  loading: boolean;
};

/**
 * Reykjanes detail, loaded the first time the layer is switched on.
 *
 * About 120 KB of geometry, so it is never part of the initial page. Once
 * fetched it is kept for the session: the underlying surveys are finished and
 * will not change.
 *
 * The one-shot guard is a ref rather than state on purpose. Held in state it
 * would be a dependency of the effect that sets it, so the effect would
 * re-run, and its cleanup would abort the very request it had just started —
 * leaving the layer permanently empty with no error to show for it.
 *
 * It records what has been **received**, not what has been started, which is
 * the same failure one step removed: React mounts effects twice under Strict
 * Mode, the first attempt is aborted by its own cleanup, and a flag set up
 * front makes the second attempt decline to run.
 */
export function useReykjanesLayer(enabled: boolean): ReykjanesState {
  const [state, setState] = useState<{ layer: ReykjanesLayer | null; unavailable: boolean }>({
    layer: null,
    unavailable: false,
  });
  const received = useRef(false);

  useEffect(() => {
    if (!enabled || received.current) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/reykjanes", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as ReykjanesResult;
        if (controller.signal.aborted) return;
        // A failure leaves this false, so toggling the layer again retries.
        received.current = body.ok;
        setState(
          body.ok
            ? { layer: body.layer, unavailable: false }
            : { layer: null, unavailable: true },
        );
      } catch {
        if (!controller.signal.aborted) {
          setState({ layer: null, unavailable: true });
        }
      }
    })();

    return () => controller.abort();
  }, [enabled]);

  return {
    ...state,
    loading: enabled && state.layer === null && !state.unavailable,
  };
}
