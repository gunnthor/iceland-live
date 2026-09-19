"use client";

import { useEffect, useState } from "react";
import type { EarthquakeDetailResult } from "@/domain/api";
import type { EarthquakeDetail } from "@/domain/earthquake-detail";

export type DetailState = {
  detail: EarthquakeDetail | null;
  loading: boolean;
  /** True when the lookup failed or the source has no detail endpoint. */
  unavailable: boolean;
};

/** What we hold, tagged with the event it belongs to. */
type Loaded = {
  forId: string;
  detail: EarthquakeDetail | null;
  unavailable: boolean;
};

/**
 * Fetches the full solution for the selected event.
 *
 * Deliberately non-blocking: the panel renders everything the catalogue record
 * already carries, and the uncertainties fill in when they arrive. A failure
 * here degrades to the catalogue view rather than to an error — the numbers we
 * already have are still correct.
 *
 * State is tagged with the event it was loaded for, and the mismatch is
 * resolved during render rather than by an effect that resets it. That keeps
 * the previous event's error bars from appearing for a frame under the next
 * event's magnitude, without a second render pass to clear them.
 */
export function useEarthquakeDetail(eventId: string | null): DetailState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!eventId) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/earthquakes/${encodeURIComponent(eventId)}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as EarthquakeDetailResult;
        if (controller.signal.aborted) return;

        setLoaded(
          body.ok
            ? { forId: eventId, detail: body.detail, unavailable: false }
            : { forId: eventId, detail: null, unavailable: true },
        );
      } catch {
        if (!controller.signal.aborted) {
          setLoaded({ forId: eventId, detail: null, unavailable: true });
        }
      }
    })();

    return () => controller.abort();
  }, [eventId]);

  const matches = eventId !== null && loaded?.forId === eventId;

  return {
    detail: matches ? (loaded?.detail ?? null) : null,
    loading: eventId !== null && !matches,
    unavailable: matches ? (loaded?.unavailable ?? false) : false,
  };
}
