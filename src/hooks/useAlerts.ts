"use client";

import { useEffect, useState } from "react";
import type { AlertsResult } from "@/domain/api";
import type { OfficialAlert } from "@/domain/alert";

export type AlertsState = {
  alerts: OfficialAlert[];
  /** True when the broker could not be reached. Distinct from "none in force". */
  unavailable: boolean;
};

/** Warnings change on the order of hours; matches the server cache window. */
const POLL_INTERVAL_MS = 3 * 60_000;

/**
 * Official warnings currently in force.
 *
 * An empty list is the normal state and is not an error. `unavailable` is
 * reserved for "we could not ask", which the UI must distinguish, because
 * "no warnings" and "we don't know" are very different things to tell someone.
 *
 * The fetch lives inside the effect rather than in a hoisted callback so that
 * no state update happens synchronously while the effect runs.
 */
export function useAlerts(): AlertsState {
  const [state, setState] = useState<AlertsState>({ alerts: [], unavailable: false });

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch("/api/alerts", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as AlertsResult;
        if (controller.signal.aborted) return;
        setState(
          body.ok
            ? { alerts: body.alerts, unavailable: false }
            : { alerts: [], unavailable: true },
        );
      } catch {
        if (!controller.signal.aborted) setState({ alerts: [], unavailable: true });
      }
    };

    void load();

    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  return state;
}
