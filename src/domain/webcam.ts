/**
 * Road webcams.
 *
 * ## Why not IMO
 *
 * IMO's EPOS gateway does publish a webcam endpoint, but it holds three
 * datasets from the 2014–15 Holuhraun eruption as `.tar.gz` archives. There is
 * no live camera in it. The Icelandic Road and Coastal Administration
 * (Vegagerðin) runs a national network that *is* live — images refresh several
 * times an hour — with a documented open-data API, and it happens to cover the
 * ground this product cares about: Grindavíkurvegur, Suðurstrandarvegur,
 * Krýsuvíkurvegur and Kleifarvatn.
 *
 * ## Attribution
 *
 * Vegagerðin's terms permit redistribution, including commercially, on one
 * condition: the source must be acknowledged with a specific sentence, and use
 * must not imply official status or endorsement. `IRCA_ATTRIBUTION` is that
 * sentence verbatim, and it is rendered wherever these images are.
 */

/** The exact acknowledgement Vegagerðin's terms require. */
export const IRCA_ATTRIBUTION =
  "Based on information provided by the Icelandic Road and Coastal Administration (IRCA)";

/** One camera angle at a site. */
export type WebcamView = {
  /** Stable id: station number plus the image filename. */
  id: string;
  /** What this angle looks at, in the source's own words (Icelandic). */
  description: string;
  /** Published image URL, rewritten to our proxy. */
  imageUrl: string;
};

/**
 * A camera site. Sites carry several views — Hellisheiði has three — which the
 * source returns as separate rows sharing a station number.
 */
export type WebcamSite = {
  /** Vegagerðin station number. */
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  /** Road name, e.g. "Grindavíkurvegur". */
  road: string | null;
  /** Road number, e.g. "43". */
  roadNumber: string | null;
  views: WebcamView[];
};

/** Great-circle-free ordering helper: sites nearest a point, nearest first. */
export function sitesNearest(
  sites: readonly WebcamSite[],
  point: { latitude: number; longitude: number },
  limit: number,
): WebcamSite[] {
  // Squared degrees, longitude scaled for latitude. Ordering only, never shown.
  const scale = Math.cos((point.latitude * Math.PI) / 180) ** 2;
  return [...sites]
    .map((site) => ({
      site,
      d:
        (site.latitude - point.latitude) ** 2 +
        (site.longitude - point.longitude) ** 2 * scale,
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((entry) => entry.site);
}
