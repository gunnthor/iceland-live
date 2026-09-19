"use client";

import { useEffect, useState } from "react";
import type { DispersionPointResult } from "@/domain/api";
import type { DispersionPointSeries } from "@/domain/dispersion";

export type DispersionPointState = {
  series: DispersionPointSeries[];
  loading: boolean;
  /** Set when the run could not be evaluated there, with IMO's reason. */
  unavailable: string | null;
};

/** What a request is for, so a stale answer can be recognised as stale. */
type Loaded = {
  key: string;
  series: DispersionPointSeries[];
  unavailable: string | null;
};

function keyFor(runId: string, latitude: number, longitude: number): string {
  return `${runId}:${latitude.toFixed(3)}:${longitude.toFixed(3)}`;
}

/**
 * A dispersal run evaluated at one place.
 *
 * Tagged with the request it answers and reconciled during render, the same
 * way `useEarthquakeDetail` handles its own switch: changing station must not
 * show the previous station's curve for a frame under the new station's name.
 * These are concentrations at a named place, and one frame of the wrong pair
 * is one frame of a false statement.
 */
export function useDispersionPoint(
  runId: string | null,
  point: { latitude: number; longitude: number } | null,
): DispersionPointState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  /*
   * Depended on as two numbers rather than as the object holding them. A
   * caller that rebuilds `{ latitude, longitude }` on every render — which is
   * the ordinary thing to do when it is derived from a list — would otherwise
   * give this effect a new dependency each time and turn it into a loop
   * against IMO's service.
   */
  const latitude = point?.latitude ?? null;
  const longitude = point?.longitude ?? null;

  const key =
    runId && latitude !== null && longitude !== null
      ? keyFor(runId, latitude, longitude)
      : null;

  useEffect(() => {
    if (!runId || latitude === null || longitude === null) return;

    const controller = new AbortController();
    const requestKey = keyFor(runId, latitude, longitude);

    void (async () => {
      try {
        const response = await fetch(
          `/api/dispersion/point?run=${encodeURIComponent(runId)}` +
            `&lat=${latitude}&lon=${longitude}`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        const body = (await response.json()) as DispersionPointResult;
        if (controller.signal.aborted) return;

        setLoaded(
          body.ok
            ? { key: requestKey, series: body.series, unavailable: null }
            : { key: requestKey, series: [], unavailable: body.message },
        );
      } catch {
        if (!controller.signal.aborted) {
          setLoaded({
            key: requestKey,
            series: [],
            unavailable: "The simulation could not be evaluated there.",
          });
        }
      }
    })();

    return () => controller.abort();
  }, [runId, latitude, longitude]);

  const matches = key !== null && loaded?.key === key;

  return {
    series: matches ? (loaded?.series ?? []) : [],
    loading: key !== null && !matches,
    unavailable: matches ? (loaded?.unavailable ?? null) : null,
  };
}
