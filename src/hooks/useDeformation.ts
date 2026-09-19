"use client";

import { useEffect, useRef, useState } from "react";
import type { DeformationResult } from "@/domain/api";
import type { GnssStation, Interferogram } from "@/domain/deformation";

export type DeformationState = {
  interferograms: Interferogram[];
  stations: GnssStation[];
  loading: boolean;
  unavailable: boolean;
};

const EMPTY: Omit<DeformationState, "loading"> = {
  interferograms: [],
  stations: [],
  unavailable: false,
};

/**
 * IMO's published deformation products and GNSS network.
 *
 * Fetched once, on first demand — the catalogue changes on the order of days
 * and the payload is ~90 KB. The "already requested" flag is a ref so the
 * effect does not re-run and abort its own request.
 */
export function useDeformation(enabled: boolean): DeformationState {
  const [state, setState] = useState(EMPTY);
  const requested = useRef(false);

  useEffect(() => {
    if (!enabled || requested.current) return;
    requested.current = true;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/insar", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as DeformationResult;
        if (controller.signal.aborted) return;
        setState(
          body.ok
            ? {
                interferograms: body.interferograms,
                stations: body.stations,
                unavailable: false,
              }
            : { ...EMPTY, unavailable: true },
        );
      } catch {
        if (!controller.signal.aborted) setState({ ...EMPTY, unavailable: true });
        requested.current = false;
      }
    })();

    return () => controller.abort();
  }, [enabled]);

  return {
    ...state,
    loading:
      enabled &&
      state.interferograms.length === 0 &&
      state.stations.length === 0 &&
      !state.unavailable,
  };
}
