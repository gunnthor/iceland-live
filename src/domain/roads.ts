/**
 * Road weather and conditions from Vegagerðin.
 *
 * Two different things, from two endpoints:
 *
 *  - **Weather stations** carry coordinates and live readings. Wind is the one
 *    that matters most here: it decides where volcanic gas goes, which is the
 *    hazard from a Reykjanes eruption that reaches the most people.
 *  - **Road conditions** come in two forms. The open-data feed carries status
 *    text per segment with no geometry; Vegagerðin's ArcGIS service carries the
 *    same conditions *with* line geometry, which is what the map layer uses.
 */

export type RoadWeatherStation = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  altitudeM: number | null;
  /** When the reading was taken. */
  observedAt: string | null;
  /** Degrees from north the wind is blowing *from*. */
  windDirectionDeg: number | null;
  /** Compass label as published, e.g. "N", "SW". */
  windDirectionLabel: string | null;
  windSpeedMs: number | null;
  windGustMs: number | null;
  /** Air temperature, °C. */
  airTempC: number | null;
  /** Road surface temperature, °C. Often the more useful of the two in winter. */
  roadTempC: number | null;
  relativeHumidity: number | null;
};

/**
 * A road segment's condition.
 *
 * `colour` is Vegagerðin's own line colour for the status, reused rather than
 * reinvented so the reading matches their own maps.
 */
export type RoadCondition = {
  id: number;
  /** Segment name, e.g. "Grindavíkurvegur: Reykjanesbraut - Norðurljósavegur". */
  name: string;
  /** Full status, e.g. "Greiðfært", "Ófært - Vegna aurbleytu". */
  status: string;
  /** Abbreviated status. */
  shortStatus: string | null;
  /** Vegagerðin's own hex colour for this status. */
  colour: string | null;
  /** When the status was published. */
  updatedAt: string | null;
  /** True for highland roads, which are seasonally closed by default. */
  highland: boolean;
};

/** The status the overwhelming majority of segments carry. */
export const CLEAR_STATUS = "Greiðfært";

/**
 * Segments whose status is anything other than plainly clear.
 *
 * Of ~970 segments, ~835 normally read "Greiðfært". Listing all of them would
 * bury the handful that are not, which is the only part worth a reader's time.
 */
export function notableConditions(conditions: readonly RoadCondition[]): RoadCondition[] {
  return conditions.filter((condition) => condition.status !== CLEAR_STATUS);
}


/**
 * A road segment's condition, with the geometry to draw it.
 *
 * From Vegagerðin's ArcGIS `data/faerd` service rather than the open-data feed.
 * Only segments that are not plainly clear are fetched: 146 of 1,565 at the
 * time of writing, which keeps the layer small and is also the only part worth
 * drawing — a map where every road is green says nothing.
 */
export type RoadConditionSegment = {
  /** `IDBUTUR`, the same segment key the open-data feed uses. */
  id: number;
  /** Route name, e.g. "Norðurljósavegur sunnan Bláalóns". */
  name: string | null;
  /** Road number, e.g. "F910" or "43". */
  roadNumber: string | null;
  /** Condition, e.g. "Ófært", "Ekki í þjónustu", "Fært fjallabílum". */
  status: string;
  /** Vegagerðin's own colour for the status. */
  colour: string | null;
  /** When the record was last modified. */
  updatedAt: string | null;
};

/**
 * Severity ordering for drawing: worse conditions go on top.
 *
 * Vegagerðin gives "Fært fjallabílum" (4x4 only) the same green as fully clear,
 * which is right for their audience but leaves a map where an impassable road
 * and a 4x4-only track are hard to tell apart at a glance. The ordering is ours;
 * the colours stay theirs.
 */
export function conditionSeverity(status: string): number {
  if (status.startsWith("Ófært")) return 3;
  if (status.startsWith("Ekki í þjónustu") || status.startsWith("Vegur ekki")) return 2;
  if (status.startsWith("Fært fjallabílum")) return 1;
  return 0;
}

/**
 * A stretch of road, reduced to the line it follows.
 *
 * Deliberately not GeoJSON and deliberately lean: this is server-side
 * geometry used to test routes against a modelled footprint, and none of it
 * is ever sent to the browser. Only the names that matched are.
 *
 * `points` is generalised by the service to about two kilometres, which is
 * well inside the seven-kilometre cells of the rasters it is tested against.
 */
export type RoadSegmentLine = {
  /** `IDBUTUR`, the same segment key the condition feeds use. */
  id: number;
  /** Route name, e.g. "Grindavíkurvegur". */
  name: string | null;
  roadNumber: string | null;
  points: Array<{ latitude: number; longitude: number }>;
};

/**
 * One route a modelled plume reaches.
 *
 * The figure is the model's own value at **one sampled point** on the route,
 * not along the whole of it: asking the per-location endpoint at every vertex
 * of every route would be thousands of requests. `sampledKm` says how far
 * that point is from the source so the reader knows what was measured, and a
 * long route may well be heavier somewhere else along it.
 */
export type RoadExposure = {
  /** Route name as Vegagerðin writes it. */
  route: string;
  roadNumber: string | null;
  /** How many of this route's segments the footprint covers. */
  segments: number;
  /** Distance from the modelled source to the sampled point, km. */
  sampledKm: number;
  /** Model value at the sampled point, in the layer's unit. Null if unavailable. */
  peak: number | null;
  /** This route's value as a fraction of the largest listed, in (0, 1]. */
  share: number | null;
  /** When the model's value there peaks, ISO instant. */
  peakAt: string | null;
};
