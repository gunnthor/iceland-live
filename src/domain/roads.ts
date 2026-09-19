/**
 * Road weather and conditions from Vegagerðin.
 *
 * Two different things, from two endpoints:
 *
 *  - **Weather stations** carry coordinates and live readings. Wind is the one
 *    that matters most here: it decides where volcanic gas goes, which is the
 *    hazard from a Reykjanes eruption that reaches the most people.
 *  - **Road conditions** are per-segment status text. The feed carries no
 *    geometry, so these cannot be drawn on the map — only listed.
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
