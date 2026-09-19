"use client";

import { useEffect, useRef, useState } from "react";
import type { WebcamsResult } from "@/domain/api";
import type { WebcamSite } from "@/domain/webcam";

export type WebcamsState = {
  sites: WebcamSite[];
  attribution: string | null;
  loading: boolean;
  unavailable: boolean;
};

/**
 * The road camera catalogue, loaded on first demand.
 *
 * Only the catalogue — where the cameras are. The pictures are ordinary
 * `<img>` loads against our proxy, so they refresh by changing a cache-busting
 * key rather than by anything this hook does.
 */
export function useWebcams(enabled: boolean): WebcamsState {
  const [state, setState] = useState<{
    sites: WebcamSite[];
    attribution: string | null;
    unavailable: boolean;
  }>({ sites: [], attribution: null, unavailable: false });
  const requested = useRef(false);

  useEffect(() => {
    if (!enabled || requested.current) return;
    requested.current = true;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/webcams", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as WebcamsResult;
        if (controller.signal.aborted) return;
        setState(
          body.ok
            ? { sites: body.sites, attribution: body.attribution, unavailable: false }
            : { sites: [], attribution: null, unavailable: true },
        );
      } catch {
        if (!controller.signal.aborted) {
          setState({ sites: [], attribution: null, unavailable: true });
        }
        requested.current = false;
      }
    })();

    return () => controller.abort();
  }, [enabled]);

  return {
    ...state,
    loading: enabled && state.sites.length === 0 && !state.unavailable,
  };
}
