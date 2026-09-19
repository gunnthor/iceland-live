/**
 * Ground deformation, as published by IMO.
 *
 * ## What this is, and what it is not
 *
 * IMO's EPOS gateway publishes **interferograms** — processed Sentinel-1 and
 * TerraSAR-X image pairs showing how the ground moved between two dates. Each
 * one is a finished product with a rendered image, not a measurement we derive.
 *
 * It does *not* publish processed GNSS position time series. The `/gps/*`
 * endpoints carry station metadata and raw RINEX observation files; turning
 * those into displacements needs full geodetic processing, which is neither in
 * scope nor something this project should attempt and present as fact. So
 * deformation here means "the interferograms IMO has published", and the GNSS
 * network is shown as what it is: where the instruments are.
 */

/** Satellite look direction. Determines which ground motion the image is sensitive to. */
export type OrbitDirection = "ascending" | "descending" | (string & {});

export type Interferogram = {
  /** Stable id built from the product filename. */
  id: string;
  /** IMO's name for the monitored area, e.g. "Sundhnúkur". */
  focusArea: string;
  /** First acquisition, ISO date. */
  startDate: string;
  /** Second acquisition, ISO date. Ground motion is between these two. */
  endDate: string;
  orbitDirection: OrbitDirection;
  /** Satellite code, e.g. "S1" (Sentinel-1) or "TSX" (TerraSAR-X). */
  satellite: string;
  /** Geographic extent of the rendered image. */
  bounds: { west: number; south: number; east: number; north: number };
  /**
   * Rendered wrapped interferogram, as published.
   *
   * Served through our own proxy: the host sends no CORS headers, so the
   * browser cannot load it directly onto a canvas.
   */
  imageUrl: string;
  /** IMO's landing page for the full product set. */
  productUrl: string | null;
};

/** Days between the two acquisitions. */
export function spanDays(interferogram: Interferogram): number {
  const start = Date.parse(`${interferogram.startDate}T00:00:00Z`);
  const end = Date.parse(`${interferogram.endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** Newest second-acquisition first. */
export function sortByRecency(items: readonly Interferogram[]): Interferogram[] {
  return [...items].sort((a, b) => b.endDate.localeCompare(a.endDate));
}

/**
 * A GNSS station in IMO's network.
 *
 * Shown so a reader can see what instrumentation sits under an area of
 * activity, and follow the link to IMO's own data for it. We do not plot
 * displacement, because this API does not publish any.
 */
export type GnssStation = {
  /** Four-character marker, e.g. "SENG". */
  marker: string;
  name: string;
  latitude: number;
  longitude: number;
  altitudeM: number | null;
  agency: string | null;
  /** When the station started recording. */
  since: string | null;
  /** When it stopped, or null if still in use. */
  until: string | null;
  /** IMO's site log for this station. */
  siteLogUrl: string | null;
  /** IMO's raw observation data for this station. */
  dataUrl: string | null;
};

export function isActive(station: GnssStation): boolean {
  return station.until === null;
}
