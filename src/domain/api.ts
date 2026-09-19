/**
 * The contract between our API routes and the browser.
 *
 * Shared by the route handlers and the client so a change to the payload is a
 * type error on both sides rather than a runtime surprise.
 */

import type { ActivityObservation } from "@/analytics/clusters";
import type { Histogram } from "@/analytics/histogram";
import type { EarthquakeStats } from "@/analytics/stats";
import type { Summary } from "@/analytics/summary";
import type { Earthquake } from "./earthquake";
import type { EarthquakeDetail } from "./earthquake-detail";
import type { TimeRangeId } from "./time-range";
import type { VolcanicSystem } from "./volcano";
import type { ProviderMeta } from "@/providers/types";

/** Serialised form of `EarthquakeStats`; the picked events travel whole. */
export type EarthquakeStatsPayload = EarthquakeStats;

export type EarthquakesResponse = {
  ok: true;
  range: TimeRangeId;
  /** The absolute window the payload covers, as ISO instants. */
  window: { from: string; to: string };
  /** Server time when the response was produced; the client clock starts here. */
  generatedAt: string;
  quakes: Earthquake[];
  stats: EarthquakeStatsPayload;
  summary: Summary;
  observations: ActivityObservation[];
  /**
   * The window the observations cover. Narrower than `window` for the 7d and
   * 30d ranges, where observations are capped so "elevated activity" stays a
   * statement about the present rather than about a month of background.
   */
  observationWindow: { from: string; to: string; capped: boolean };
  histogram: Histogram;
  meta: ProviderMeta;
};

export type ApiErrorResponse = {
  ok: false;
  /** Machine-readable reason, used to choose the right empty state. */
  code:
    | "upstream_unavailable"
    | "upstream_invalid"
    | "bad_request"
    | "not_found"
    | "unsupported"
    | "internal";
  /** One sentence suitable for display. */
  message: string;
};

export type EarthquakeDetailResponse = {
  ok: true;
  detail: EarthquakeDetail;
  meta: ProviderMeta;
};

export type EarthquakeDetailResult = EarthquakeDetailResponse | ApiErrorResponse;

export type EarthquakesResult = EarthquakesResponse | ApiErrorResponse;

export type VolcanoesResponse = {
  ok: true;
  generatedAt: string;
  systems: VolcanicSystem[];
  meta: ProviderMeta;
};

export type VolcanoesResult = VolcanoesResponse | ApiErrorResponse;
