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
 *
 * The one-shot guard records what has been **received**, not what has been
 * started. Setting it before the request looks equivalent and is not: React
 * mounts effects twice under Strict Mode, so the first attempt is aborted by
 * its own cleanup, and a flag set up front makes the second attempt decline to
 * run. The catalogue then never arrives and the panel sits on "Loading
 * cameras…" forever. Recording the arrival instead means an aborted attempt
 * leaves nothing behind, and a failure still allows a retry when the layer is
 * switched on again.
 */
export function useWebcams(enabled: boolean): WebcamsState {
  const [state, setState] = useState<{
    sites: WebcamSite[];
    attribution: string | null;
    unavailable: boolean;
  }>({ sites: [], attribution: null, unavailable: false });
  const received = useRef(false);

  useEffect(() => {
    if (!enabled || received.current) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/webcams", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as WebcamsResult;
        if (controller.signal.aborted) return;
        received.current = body.ok;
        setState(
          body.ok
            ? { sites: body.sites, attribution: body.attribution, unavailable: false }
            : { sites: [], attribution: null, unavailable: true },
        );
      } catch {
        if (!controller.signal.aborted) {
          setState({ sites: [], attribution: null, unavailable: true });
        }
      }
    })();

    return () => controller.abort();
  }, [enabled]);

  return {
    ...state,
    loading: enabled && state.sites.length === 0 && !state.unavailable,
  };
}
