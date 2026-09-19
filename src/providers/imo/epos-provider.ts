/**
 * Monitoring products from IMO's EPOS gateway.
 *
 *   GET /epos/satellite/insar/wrapped  — published interferograms
 *   GET /epos/gps/station              — GNSS station network
 *
 * Both are effectively static catalogues: a new interferogram appears after an
 * acquisition pair is processed, and stations change on the order of years.
 */

import type { GnssStation, Interferogram } from "@/domain/deformation";
import { sortByRecency } from "@/domain/deformation";
import type { ProviderAttribution, ProviderResult } from "@/providers/types";
import { imoFetchJson } from "./client";
import { normalizeGnssStations, normalizeInterferograms } from "./epos-normalize";

export const EPOS_ATTRIBUTION: ProviderAttribution = {
  name: "Icelandic Meteorological Office — EPOS Iceland",
  url: "https://api.vedur.is/epos/",
  note: "Interferograms and GNSS station metadata published through EPOS Iceland.",
};

/**
 * Where the published images live.
 *
 * Only this host may be proxied. The interferogram URLs come from an upstream
 * response, and proxying whatever a response asks us to fetch would turn this
 * route into an open relay.
 */
export const EPOS_DATA_HOST = "data.epos-iceland.is";

/** Our proxy path for a published image. */
export function toInsarProxyUrl(publishedUrl: string): string {
  return `/api/insar/image?src=${encodeURIComponent(publishedUrl)}`;
}

const REVALIDATE_SECONDS = 6 * 60 * 60;

export class ImoEposProvider {
  readonly id = "imo-epos";
  readonly attribution = EPOS_ATTRIBUTION;

  async fetchInterferograms(): Promise<ProviderResult<Interferogram[]>> {
    const payload = await imoFetchJson<unknown>({
      service: "epos",
      path: "/satellite/insar/wrapped",
      revalidateSeconds: REVALIDATE_SECONDS,
      timeoutMs: 30_000,
    });

    return {
      data: sortByRecency(normalizeInterferograms(payload, toInsarProxyUrl)),
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }

  /**
   * The GNSS network.
   *
   * `bbox` is `minLat,minLon,maxLat,maxLon` — note that EPOS puts latitude
   * first, unlike most bounding-box conventions.
   */
  async fetchGnssStations(bbox?: {
    south: number;
    west: number;
    north: number;
    east: number;
  }): Promise<ProviderResult<GnssStation[]>> {
    const payload = await imoFetchJson<unknown>({
      service: "epos",
      path: "/gps/station",
      query: {
        format_type: "GeoJSON",
        ...(bbox ? { bbox: `${bbox.south},${bbox.west},${bbox.north},${bbox.east}` } : {}),
      },
      revalidateSeconds: REVALIDATE_SECONDS,
      timeoutMs: 30_000,
    });

    return {
      data: normalizeGnssStations(payload),
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }
}
