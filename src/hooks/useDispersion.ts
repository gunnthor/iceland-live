"use client";

import { useEffect, useRef, useState } from "react";
import type { DispersionResult } from "@/domain/api";
import type { DispersionRun } from "@/domain/dispersion";

export type DispersionState = {
  runs: DispersionRun[];
  loading: boolean;
  /** True when IMO could not be asked. Distinct from "no current runs". */
  unavailable: boolean;
  /** True once an answer has arrived, whatever it contained. */
  loaded: boolean;
};

/**
 * Runs are produced a few times a day and each is valid for a day or two, so
 * polling is on the order of the product rather than of the page.
 */
const POLL_INTERVAL_MS = 15 * 60_000;

/**
 * IMO's current dispersal simulations, loaded the first time the layer is
 * switched on.
 *
 * An empty list is a real answer, not a failure — which is why `loaded` exists
 * separately from `loading`. "IMO has no current runs" and "we could not ask
 * IMO" have to look different on screen, and without the distinction both
 * render as an empty panel.
 *
 * The one-shot guard is a ref rather than state for the reason set out in
 * `useReykjanesLayer`: in state it becomes a dependency of the effect that
 * sets it, and the effect's cleanup then aborts the request it just started.
 */
export function useDispersion(enabled: boolean): DispersionState {
  const [state, setState] = useState<{
    runs: DispersionRun[];
    unavailable: boolean;
    loaded: boolean;
  }>({ runs: [], unavailable: false, loaded: false });
  const started = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    started.current = true;

    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch("/api/dispersion", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as DispersionResult;
        if (controller.signal.aborted) return;
        setState(
          body.ok
            ? { runs: body.runs, unavailable: false, loaded: true }
            : { runs: [], unavailable: true, loaded: true },
        );
      } catch {
        if (!controller.signal.aborted) {
          setState({ runs: [], unavailable: true, loaded: true });
        }
      }
    };

    void load();

    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled]);

  return { ...state, loading: enabled && !state.loaded };
}
