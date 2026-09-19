/**
 * Earthquake provider backed by the IMO Quakes API.
 *
 * Endpoint: GET https://api.vedur.is/quakes/events?format=csv
 * Docs:     https://api.vedur.is/  (Swagger UI, select "Quakes")
 *
 * The Quakes API is the public gateway to IMO's SeisComP earthquake catalogue,
 * which replaced the legacy SIL system as IMO's primary monitoring system.
 * We request `system=seiscomp` explicitly rather than relying on the default.
 */

import { isLikelyEarthquake, type Earthquake } from "@/domain/earthquake";
import {
  ProviderError,
  type EarthquakeProvider,
  type EarthquakeQuery,
  type ProviderAttribution,
  type ProviderResult,
} from "@/providers/types";
import { imoFetchText, toImoTimestamp } from "./client";
import { normalizeQuakesCsv } from "./normalize";

/**
 * The area we consider "Iceland" for this product, as a WKT polygon.
 *
 * The Icelandic network detects events as far away as Jan Mayen (~70°N) and the
 * mid-Atlantic (~58°N). Those are real detections but they are not what this
 * site is about, so we clip to a box that keeps every named Icelandic seismic
 * region — including the Reykjanes Ridge to the south-west and the Tjörnes
 * fracture zone to the north — while excluding far-field events.
 *
 * Bounds: 62.0°N–68.5°N, 27.0°W–12.5°W.
 */
export const ICELAND_WKT_POLYGON =
  "POLYGON((-27.0 62.0, -12.5 62.0, -12.5 68.5, -27.0 68.5, -27.0 62.0))";

export const IMO_ATTRIBUTION: ProviderAttribution = {
  name: "Icelandic Meteorological Office (Veðurstofa Íslands)",
  url: "https://en.vedur.is/",
  note: "Earthquake catalogue from IMO's SeisComP system via the public Quakes API.",
};

export type ImoQuakesProviderOptions = {
  /**
   * Seconds the Next.js data cache may reuse an upstream response.
   * Defaults to 60: IMO publishes automatic solutions within roughly a minute,
   * and this keeps us to about one upstream request per minute per deployment
   * no matter how many people have the site open.
   */
  revalidateSeconds?: number;
  /**
   * Drop events IMO has explicitly classified as something other than an
   * earthquake (quarry blasts, ice quakes, discarded detections). Unclassified
   * automatic detections are always kept — see `isLikelyEarthquake`.
   */
  earthquakesOnly?: boolean;
};

export class ImoQuakesProvider implements EarthquakeProvider {
  readonly id = "imo-quakes";
  readonly attribution = IMO_ATTRIBUTION;

  private readonly revalidateSeconds: number;
  private readonly earthquakesOnly: boolean;

  constructor(options: ImoQuakesProviderOptions = {}) {
    this.revalidateSeconds = options.revalidateSeconds ?? 60;
    this.earthquakesOnly = options.earthquakesOnly ?? true;
  }

  async fetchEarthquakes(query: EarthquakeQuery): Promise<ProviderResult<Earthquake[]>> {
    if (!(query.from instanceof Date) || Number.isNaN(query.from.getTime())) {
      throw new ProviderError("config", "EarthquakeQuery.from is not a valid Date.");
    }
    if (!(query.to instanceof Date) || Number.isNaN(query.to.getTime())) {
      throw new ProviderError("config", "EarthquakeQuery.to is not a valid Date.");
    }

    const csv = await imoFetchText({
      service: "quakes",
      path: "/events",
      query: {
        start_time: toImoTimestamp(query.from),
        end_time: toImoTimestamp(query.to),
        format: "csv",
        system: "seiscomp",
        polygon: ICELAND_WKT_POLYGON,
      },
      revalidateSeconds: this.revalidateSeconds,
      // The 30-day catalogue is ~450 KB of CSV; allow a little longer than the
      // default for a cold upstream cache.
      timeoutMs: 20_000,
    });

    const { quakes, skipped } = normalizeQuakesCsv(csv);

    if (skipped > 0) {
      console.warn(`[imo-quakes] skipped ${skipped} unusable row(s) from the IMO catalogue`);
    }

    const data = this.earthquakesOnly ? quakes.filter(isLikelyEarthquake) : quakes;

    return {
      data,
      meta: {
        providerId: this.id,
        freshness: "live",
        fetchedAt: new Date().toISOString(),
        attribution: this.attribution,
      },
    };
  }
}
