"use client";

import { useEffect, useState } from "react";
import type { DispersionExposureResult } from "@/domain/api";
import type { DispersionLayer } from "@/domain/dispersion";
import type { RoadExposure } from "@/domain/roads";

export type ExposureState = {
  routes: RoadExposure[];
  layer: DispersionLayer | null;
  /** Routes the footprint covers in total, listed or not. */
  covered: number;
  /** Size of the network the footprint was tested against. */
  checked: number;
  loading: boolean;
  /** True when the footprint could not be read at all. */
  unavailable: boolean;
};

type Loaded = {
  runId: string;
  routes: RoadExposure[];
  layer: DispersionLayer | null;
  covered: number;
  checked: number;
  unavailable: boolean;
};

/**
 * The routes a dispersal run reaches.
 *
 * One request per run, answered from a server-side cache that already holds
 * the footprint and the per-location lookups behind it. Tagged with the run it
 * answers and reconciled during render, so one scenario's roads never appear
 * for a frame under another scenario's name.
 */
export function useDispersionExposure(runId: string | null): ExposureState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!runId) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/dispersion/exposure?run=${encodeURIComponent(runId)}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as DispersionExposureResult;
        if (controller.signal.aborted) return;

        setLoaded(
          body.ok
            ? {
                runId,
                routes: body.routes,
                layer: body.layer,
                covered: body.covered,
                checked: body.checked,
                unavailable: body.unavailable,
              }
            : { runId, routes: [], layer: null, covered: 0, checked: 0, unavailable: true },
        );
      } catch {
        if (!controller.signal.aborted) {
          setLoaded({ runId, routes: [], layer: null, covered: 0, checked: 0, unavailable: true });
        }
      }
    })();

    return () => controller.abort();
  }, [runId]);

  const matches = runId !== null && loaded?.runId === runId;

  return {
    routes: matches ? (loaded?.routes ?? []) : [],
    layer: matches ? (loaded?.layer ?? null) : null,
    covered: matches ? (loaded?.covered ?? 0) : 0,
    checked: matches ? (loaded?.checked ?? 0) : 0,
    loading: runId !== null && !matches,
    unavailable: matches ? (loaded?.unavailable ?? false) : false,
  };
}
