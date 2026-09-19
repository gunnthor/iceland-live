/**
 * The detailed solution for a single event, from `GET /quakes/events/{id}`.
 *
 * The bulk catalogue gives a point estimate; this gives the error bars around
 * it. That distinction matters most for automatic solutions, which make up the
 * majority of any recent window and can move substantially on review.
 */

/** A measured value with the error IMO reports for it. */
export type Measured = {
  value: number;
  /**
   * Reported uncertainty, in the unit given by the field that owns it, or null
   * when IMO did not report one.
   *
   * Note that `0` is meaningful and distinct from `null`: a depth uncertainty
   * of exactly zero accompanies an operator-assigned depth, and means the value
   * was *fixed* rather than determined — see `isFixedDepth`.
   */
  uncertainty: number | null;
  /** Confidence level the uncertainty is quoted at, as a percentage. */
  confidenceLevel: number | null;
};

/**
 * How the depth was arrived at, as IMO reports it.
 *
 * Observed values: `"from location"` (solved for alongside the epicentre),
 * `"operator assigned"` (fixed by a seismologist, typically at 10 km, when the
 * data will not constrain it) and `"undefined"`.
 */
export type DepthType = "from location" | "operator assigned" | "undefined" | (string & {});

export type EarthquakeDetail = {
  id: string;
  /** IMO's region description, normally the seismic region name. */
  regionText: string | null;
  magnitude: Measured | null;
  /** Magnitude scale, e.g. "ML_SIL". */
  magnitudeType: string | null;
  originTime: { iso: string; uncertaintySeconds: number | null; confidenceLevel: number | null } | null;
  /** Uncertainties are in kilometres. */
  latitude: Measured | null;
  longitude: Measured | null;
  depthKm: Measured | null;
  depthType: DepthType | null;
  evaluationMode: "manual" | "automatic" | null;
  eventType: string | null;
};

/**
 * True when the depth was fixed by an operator rather than determined from the
 * data.
 *
 * IMO's convention is to assign 10 km when the recorded phases will not
 * constrain depth. The solution then carries an uncertainty of exactly zero,
 * which reads as "perfectly known" if taken at face value — the opposite of
 * what it means. Anywhere depth is shown with an error bar, this must be
 * checked first.
 */
export function isFixedDepth(detail: EarthquakeDetail): boolean {
  return (
    detail.depthType === "operator assigned" &&
    detail.depthKm !== null &&
    detail.depthKm.uncertainty === 0
  );
}

/**
 * Combined horizontal uncertainty in km.
 *
 * IMO reports latitude and longitude errors separately. The quadrature sum is
 * the radius of the circle with the same area as the (axis-aligned) error
 * ellipse, which is the honest one-number summary of "how well located is this".
 */
export function horizontalUncertaintyKm(detail: EarthquakeDetail): number | null {
  const lat = detail.latitude?.uncertainty;
  const lon = detail.longitude?.uncertainty;
  if (lat == null || lon == null) return null;
  return Math.sqrt(lat * lat + lon * lon);
}
