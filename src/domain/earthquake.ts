/**
 * The normalized internal earthquake model for Iceland Live.
 *
 * This shape is derived from what the Icelandic Meteorological Office (IMO)
 * Quakes API actually returns (see `src/providers/imo/normalize.ts`), not from
 * a guess. Every consumer in the app — map, charts, analytics, activity feed —
 * reads this type and never an upstream response shape.
 */

/** Data sources we can attribute an observation to. */
export type DataSource = "IMO";

/**
 * Event classification as assigned by IMO.
 *
 * IMO only assigns a type to events a seismologist has manually reviewed, so
 * this is `null` for most automatically detected events. `null` therefore means
 * "not yet classified", NOT "not an earthquake".
 *
 * The documented enum in the OpenAPI spec is
 * `earthquake | explosion | not locatable | not existing | other`, but live data
 * also contains values such as "mining explosion", "ice quake" and
 * "outside of network interest". We keep the raw string for anything unknown so
 * new upstream values never get silently dropped.
 */
export type EventType =
  | "earthquake"
  | "explosion"
  | "mining explosion"
  | "ice quake"
  | "not locatable"
  | "not existing"
  | "outside of network interest"
  | (string & {});

/**
 * How far an event has progressed through IMO's review workflow.
 *
 * - `reviewed`  — a seismologist has reviewed the solution (IMO status "reviewed")
 * - `automatic` — an automatic detection not yet reviewed (IMO status "confirmed")
 * - `unknown`   — upstream did not report a status
 */
export type ReviewStatus = "reviewed" | "automatic" | "unknown";

/** Whether the location/magnitude solution came from a human or the detector. */
export type EvaluationMode = "manual" | "automatic";

export type Earthquake = {
  /** IMO event identifier, e.g. "IMO2026smblhr". Stable and globally unique. */
  id: string;
  /** Origin time as an ISO 8601 UTC instant. */
  occurredAt: string;
  /** When IMO last revised this solution, if reported. */
  updatedAt: string | null;
  latitude: number;
  longitude: number;
  /** Hypocentre depth below the surface, in kilometres. */
  depthKm: number | null;
  /**
   * Magnitude as reported by IMO. May be negative: the Icelandic network is
   * dense enough to locate events well below magnitude 0.
   */
  magnitude: number | null;
  /** Magnitude scale used, e.g. "ML_SIL" (local magnitude) or "Mpgv_w". */
  magnitudeType: string | null;
  /** IMO's named seismic region, e.g. "Kleifarvatn". Icelandic spelling. */
  region: string | null;
  /** IMO classification; `null` when the event has not been reviewed yet. */
  eventType: EventType | null;
  reviewStatus: ReviewStatus;
  evaluationMode: EvaluationMode | null;
  source: DataSource;
};

/**
 * Event types IMO has explicitly classified as something other than a tectonic
 * earthquake. We exclude these from the default view so quarry blasts and
 * discarded detections do not appear as seismicity.
 *
 * Unclassified events (`eventType === null`) are kept: they are ordinary
 * automatic detections awaiting review, and excluding them would hide most
 * recent activity.
 */
export const NON_EARTHQUAKE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "explosion",
  "mining explosion",
  "ice quake",
  "not locatable",
  "not existing",
  "outside of network interest",
]);

export function isLikelyEarthquake(quake: Earthquake): boolean {
  return quake.eventType === null || !NON_EARTHQUAKE_EVENT_TYPES.has(quake.eventType);
}
