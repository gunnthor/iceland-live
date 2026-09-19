"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EarthquakesResponse, EarthquakesResult } from "@/domain/api";
import type { TimeRangeId } from "@/domain/time-range";

export type DataState = {
  data: EarthquakesResponse | null;
  /** Set when the most recent attempt failed. Previous data is kept alongside. */
  error: { code: string; message: string } | null;
  /** True while refreshing in the background with data already on screen. */
  refreshing: boolean;
  /** True when the browser reports itself offline. */
  offline: boolean;
  refresh: () => void;
};

/** How often to poll for new events. Matches the server's cache window. */
const POLL_INTERVAL_MS = 60_000;

/**
 * Fetches the earthquake payload for a range and keeps it current.
 *
 * Behaviour that matters:
 *  - Changing range fetches immediately but keeps the previous data visible, so
 *    the map does not blank out between windows.
 *  - A failed refresh never discards data that is already on screen; it surfaces
 *    as an error banner over the last good payload.
 *  - Polling pauses while the tab is hidden and catches up on return, so a tab
 *    left open overnight is not quietly hammering the API.
 */
export function useEarthquakeData(
  range: TimeRangeId,
  initialData: EarthquakesResponse | null,
): DataState {
  const [data, setData] = useState<EarthquakesResponse | null>(initialData);
  const [error, setError] = useState<DataState["error"]>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);

  // Guards against a slow response for an old range overwriting a newer one.
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (targetRange: TimeRangeId, background: boolean) => {
      const requestId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (background) setRefreshing(true);

      try {
        const response = await fetch(`/api/earthquakes?range=${targetRange}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as EarthquakesResult;
        if (requestId !== requestIdRef.current) return;

        if (body.ok) {
          setData(body);
          setError(null);
        } else {
          setError({ code: body.code, message: body.message });
        }
      } catch (cause) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        setError({
          code: "network",
          message: "Could not reach Iceland Live. Check your connection.",
        });
        console.warn("[earthquakes] fetch failed", cause);
      } finally {
        if (requestId === requestIdRef.current) setRefreshing(false);
      }
    },
    [],
  );

  const refresh = useCallback(() => {
    void load(range, true);
  }, [load, range]);

  // Range changes: fetch unless the server already gave us this exact range.
  const servedRange = initialData?.range;
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (!hasFetchedRef.current && range === servedRange && initialData) {
      hasFetchedRef.current = true;
      return;
    }
    hasFetchedRef.current = true;
    void load(range, data !== null);
    // `data` is read only to decide between a blocking and a background load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, load, servedRange]);

  // Polling, paused while the tab is in the background.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => void load(range, true), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void load(range, true);
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [range, load]);

  // Offline awareness, so the error state can say something accurate.
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { data, error, refreshing, offline, refresh };
}
