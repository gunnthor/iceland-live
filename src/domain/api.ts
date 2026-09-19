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
import type { OfficialAlert } from "./alert";
import type { GnssStation, Interferogram } from "./deformation";
import type { WebcamSite } from "./webcam";
import type { RegionTally } from "@/analytics/stats";
import type { Earthquake } from "./earthquake";
import type { EarthquakeDetail } from "./earthquake-detail";
import type { TimeRangeId } from "./time-range";
import type { ReykjanesLayer } from "./reykjanes";
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
   * Per-region activity for this window, busiest first, each compared against
   * that region's own year where history allows.
   */
  regions: RegionTally[];
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

export type AlertsResponse = {
  ok: true;
  generatedAt: string;
  /** Warnings in force, most serious first. Empty is the normal state. */
  alerts: OfficialAlert[];
  meta: ProviderMeta;
};

export type AlertsResult = AlertsResponse | ApiErrorResponse;

export type VolcanoesResponse = {
  ok: true;
  generatedAt: string;
  systems: VolcanicSystem[];
  meta: ProviderMeta;
};

export type VolcanoesResult = VolcanoesResponse | ApiErrorResponse;

export type ReykjanesResponse = {
  ok: true;
  generatedAt: string;
  layer: ReykjanesLayer;
  meta: ProviderMeta;
};

export type ReykjanesResult = ReykjanesResponse | ApiErrorResponse;

export type DeformationResponse = {
  ok: true;
  generatedAt: string;
  /** Published interferograms, newest acquisition first. */
  interferograms: Interferogram[];
  /** GNSS stations. Metadata only — this API publishes no displacements. */
  stations: GnssStation[];
  meta: ProviderMeta;
};

export type DeformationResult = DeformationResponse | ApiErrorResponse;

export type WebcamsResponse = {
  ok: true;
  generatedAt: string;
  sites: WebcamSite[];
  /** The acknowledgement IRCA's terms require; rendered wherever images are. */
  attribution: string;
  meta: ProviderMeta;
};

export type WebcamsResult = WebcamsResponse | ApiErrorResponse;
