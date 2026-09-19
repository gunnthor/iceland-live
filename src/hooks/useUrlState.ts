"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseTimeRange, type TimeRangeId } from "@/domain/time-range";

/**
 * Filters that belong in the URL.
 *
 * The test is whether a link carrying the value would be useful to send to
 * someone: the window you are looking at and the event you have open both are.
 * Panel sort order and whether a sheet is expanded are not, so they stay in
 * component state.
 */
export type UrlState = {
  range: TimeRangeId;
  /** IMO event id of the selected earthquake. */
  eventId: string | null;
  showVolcanoes: boolean;
};

export type UrlStateActions = {
  setRange: (range: TimeRangeId) => void;
  setEventId: (eventId: string | null) => void;
  setShowVolcanoes: (show: boolean) => void;
};

export function readUrlState(params: URLSearchParams): UrlState {
  return {
    range: parseTimeRange(params.get("range")),
    eventId: params.get("event"),
    showVolcanoes: params.get("volcanoes") === "1",
  };
}

export function useUrlState(): UrlState & UrlStateActions {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = readUrlState(new URLSearchParams(searchParams.toString()));

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const query = params.toString();
      // `replace` with scroll disabled: these are view changes, not navigation,
      // and each one should not add a history entry to back out of.
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return {
    ...state,
    setRange: useCallback(
      (range) =>
        update((params) => {
          if (range === "24h") params.delete("range");
          else params.set("range", range);
        }),
      [update],
    ),
    setEventId: useCallback(
      (eventId) =>
        update((params) => {
          if (eventId) params.set("event", eventId);
          else params.delete("event");
        }),
      [update],
    ),
    setShowVolcanoes: useCallback(
      (show) =>
        update((params) => {
          if (show) params.set("volcanoes", "1");
          else params.delete("volcanoes");
        }),
      [update],
    ),
  };
}
