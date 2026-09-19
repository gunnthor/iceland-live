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
  showReykjanes: boolean;
  showDeformation: boolean;
  showWebcams: boolean;
  showEnvironment: boolean;
  showDispersion: boolean;
  /** Vegagerðin station number of the camera being watched, if any. */
  webcamId: number | null;
  /** Id of the interferogram laid over the map, if any. */
  insarId: string | null;
  /** Run UUID of the dispersal simulation laid over the map, if any. */
  dispersionRunId: string | null;
};

export type UrlStateActions = {
  setRange: (range: TimeRangeId) => void;
  setEventId: (eventId: string | null) => void;
  setShowVolcanoes: (show: boolean) => void;
  setShowReykjanes: (show: boolean) => void;
  setShowDeformation: (show: boolean) => void;
  setShowWebcams: (show: boolean) => void;
  setShowEnvironment: (show: boolean) => void;
  setShowDispersion: (show: boolean) => void;
  setWebcamId: (id: number | null) => void;
  setInsarId: (id: string | null) => void;
  setDispersionRunId: (id: string | null) => void;
};

export function readUrlState(params: URLSearchParams): UrlState {
  return {
    range: parseTimeRange(params.get("range")),
    eventId: params.get("event"),
    showVolcanoes: params.get("volcanoes") === "1",
    showReykjanes: params.get("reykjanes") === "1",
    showDeformation: params.get("deformation") === "1",
    showWebcams: params.get("cams") === "1",
    showEnvironment: params.get("air") === "1",
    showDispersion: params.get("plume") === "1",
    webcamId: (() => {
      const raw = params.get("cam");
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isInteger(parsed) ? parsed : null;
    })(),
    insarId: params.get("insar"),
    /*
     * Validated on the way in, not just on the way out. It reaches an upstream
     * request path, and a link is something anyone can hand you.
     */
    dispersionRunId: (() => {
      const raw = params.get("run");
      if (!raw) return null;
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
        ? raw.toLowerCase()
        : null;
    })(),
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
    setShowReykjanes: useCallback(
      (show) =>
        update((params) => {
          if (show) params.set("reykjanes", "1");
          else params.delete("reykjanes");
        }),
      [update],
    ),
    setShowDeformation: useCallback(
      (show) =>
        update((params) => {
          if (show) params.set("deformation", "1");
          else {
            params.delete("deformation");
            // The overlay belongs to the layer; switching it off clears it.
            params.delete("insar");
          }
        }),
      [update],
    ),
    setShowWebcams: useCallback(
      (show) =>
        update((params) => {
          if (show) params.set("cams", "1");
          else params.delete("cams");
        }),
      [update],
    ),
    setShowEnvironment: useCallback(
      (show) =>
        update((params) => {
          if (show) params.set("air", "1");
          else params.delete("air");
        }),
      [update],
    ),
    setShowDispersion: useCallback(
      (show) =>
        update((params) => {
          if (show) params.set("plume", "1");
          else {
            params.delete("plume");
            // The overlay belongs to the layer; switching it off clears it.
            params.delete("run");
          }
        }),
      [update],
    ),
    setWebcamId: useCallback(
      (id) =>
        update((params) => {
          if (id === null) {
            params.delete("cam");
          } else {
            params.set("cam", String(id));
            // Watching a camera implies the layer that shows where it is.
            params.set("cams", "1");
          }
        }),
      [update],
    ),
    setInsarId: useCallback(
      (id) =>
        update((params) => {
          if (id) {
            params.set("insar", id);
            params.set("deformation", "1");
          } else {
            params.delete("insar");
          }
        }),
      [update],
    ),
    setDispersionRunId: useCallback(
      (id) =>
        update((params) => {
          if (id) {
            params.set("run", id);
            params.set("plume", "1");
          } else {
            params.delete("run");
          }
        }),
      [update],
    ),
  };
}
