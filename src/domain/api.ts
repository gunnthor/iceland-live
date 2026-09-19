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
import type { DispersionRun } from "./dispersion";
import type { AirQualityStation } from "./air-quality";
import type { RoadCondition, RoadWeatherStation } from "./roads";
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

export type EnvironmentResponse = {
  ok: true;
  generatedAt: string;
  air: AirQualityStation[];
  /** Set when the air network could not be reached; `air` is then empty. */
  airError: string | null;
  roadWeather: RoadWeatherStation[];
  /** Only segments that are not plainly clear. */
  roadConditions: RoadCondition[];
  /** The same conditions with line geometry, for the map layer. */
  roadConditionGeometry: GeoJSON.FeatureCollection;
  /** How many segments were checked, so the filtered list has a denominator. */
  roadConditionsTotal: number;
  roadsError: string | null;
  /** The acknowledgement IRCA's terms require. */
  roadAttribution: string;
  meta: ProviderMeta;
};

export type EnvironmentResult = EnvironmentResponse | ApiErrorResponse;

/**
 * Dispersal simulations.
 *
 * An empty `runs` list is an ordinary answer meaning IMO has no current runs,
 * not a failure. Every run is a model scenario: see `src/domain/dispersion.ts`
 * for why nothing built on this may imply an eruption.
 */
export type DispersionResponse = {
  ok: true;
  generatedAt: string;
  runs: DispersionRun[];
  meta: ProviderMeta;
};

export type DispersionResult = DispersionResponse | ApiErrorResponse;
