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
  /** A coordinate picked off the map, where the run is being evaluated. */
  pickedPlace: Place | null;
};

export type Place = { latitude: number; longitude: number };

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
  setPickedPlace: (place: Place | null) => void;
};

/**
 * Decimals a coordinate carries in the URL.
 *
 * Three is about a hundred metres, which is both finer than the dispersal
 * model's own grid and exactly what the server rounds to before caching a
 * probe. Writing more would make two links to the same place look like two
 * places and miss the same cache entry twice.
 */
const PLACE_DECIMALS = 3;

/**
 * A plain decimal number and nothing else.
 *
 * `Number` would also accept `0x3f`, `1e2`, `Infinity` and a string of
 * spaces, none of which anybody typed into a link on purpose. The `run`
 * parameter beside this one is matched against a shape rather than parsed
 * loosely for the same reason: a link is something anyone can hand you.
 */
const DECIMAL = /^-?\d{1,3}(?:\.\d{1,10})?$/;

export function formatPlace(place: Place): string {
  return `${place.latitude.toFixed(PLACE_DECIMALS)},${place.longitude.toFixed(PLACE_DECIMALS)}`;
}

/**
 * `lat,lon`, or `null` for anything else.
 *
 * Validated on the way in with the bounds the point API applies on the way
 * out, so a malformed link falls back to the nearest station rather than
 * putting a coordinate nobody checked into a request. Whether the place is
 * inside the selected run's model grid is not decided here — that depends on
 * which run is open, and the server answers it in words.
 */
export function parsePlace(raw: string | null): Place | null {
  if (!raw) return null;

  const parts = raw.split(",");
  if (parts.length !== 2) return null;

  const [latitude, longitude] = parts.map((part) => part.trim());
  if (!latitude || !longitude) return null;
  if (!DECIMAL.test(latitude) || !DECIMAL.test(longitude)) return null;

  const lat = Number(latitude);
  const lon = Number(longitude);
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;

  // Rounded on the way in as well as out, so a hand-widened link asks the
  // same question — and hits the same cache entry — as the one we wrote.
  const factor = 10 ** PLACE_DECIMALS;
  return { latitude: Math.round(lat * factor) / factor, longitude: Math.round(lon * factor) / factor };
}

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
    pickedPlace: parsePlace(params.get("place")),
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
            // The overlay belongs to the layer; switching it off clears it,
            // and the place is a question asked about the overlay.
            params.delete("run");
            params.delete("place");
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
    setPickedPlace: useCallback(
      (place) =>
        update((params) => {
          if (place) {
            params.set("place", formatPlace(place));
            // A place is only a question about a run, so it implies the layer
            // that puts one on the map — as the run and the overlay do.
            params.set("plume", "1");
          } else {
            params.delete("place");
          }
        }),
      [update],
    ),
  };
}
