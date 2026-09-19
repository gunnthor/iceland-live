/**
 * Offline earthquake provider backed by a frozen snapshot of real IMO data.
 *
 * Purpose: let the interface be built and reviewed without network access, and
 * give tests a realistic catalogue. It is never a fallback for a failed live
 * fetch — an upstream failure must surface as an unavailable/stale state, not
 * quietly become sample data.
 *
 * Results are reported with `freshness: "fixture"` so the UI can label them.
 */

import type { Earthquake } from "@/domain/earthquake";
import { isLikelyEarthquake } from "@/domain/earthquake";
import { normalizeQuakesCsv } from "@/providers/imo/normalize";
import type {
  EarthquakeProvider,
  EarthquakeQuery,
  ProviderAttribution,
  ProviderResult,
} from "@/providers/types";
import snapshot from "./quakes-snapshot.json";

/**
 * The snapshot is a JSON envelope around the raw upstream CSV. JSON avoids any
 * escaping questions around a 130 KB text blob and imports identically in Next
 * and in the test runner.
 */
const FIXTURE_CAPTURED_AT: string = snapshot.capturedAt;
const FIXTURE_QUAKES_CSV: string = snapshot.csv;

const FIXTURE_ATTRIBUTION: ProviderAttribution = {
  name: "Development fixture (snapshot of Icelandic Meteorological Office data)",
  url: "https://en.vedur.is/",
  note: "Frozen sample data for offline development. Not current.",
};

export type FixtureProviderOptions = {
  /**
   * Shift every timestamp forward so the newest event in the snapshot lands at
   * "now".
   *
   * Without this the snapshot is always days old, and recency-dependent UI
   * (pulse animation, "3 min ago", the 1h range) cannot be exercised offline.
   * The shift is applied uniformly, so the *shape* of the activity is
   * unchanged. Data shifted this way is still reported as `fixture` and the
   * interface labels it as sample data, so nothing is presented as current.
   */
  shiftToNow?: boolean;
};

export class FixtureEarthquakeProvider implements EarthquakeProvider {
  readonly id = "fixture-quakes";
  readonly attribution = FIXTURE_ATTRIBUTION;

  private readonly shiftToNow: boolean;
  private cache: Earthquake[] | null = null;

  constructor(options: FixtureProviderOptions = {}) {
    this.shiftToNow = options.shiftToNow ?? true;
  }

  async fetchEarthquakes(query: EarthquakeQuery): Promise<ProviderResult<Earthquake[]>> {
    const all = this.load();
    const fromMs = query.from.getTime();
    const toMs = query.to.getTime();

    const data = all.filter((quake) => {
      const at = Date.parse(quake.occurredAt);
      return at >= fromMs && at < toMs;
    });

    return {
      data,
      meta: {
        providerId: this.id,
        freshness: "fixture",
        fetchedAt: FIXTURE_CAPTURED_AT,
        attribution: this.attribution,
      },
    };
  }

  private load(): Earthquake[] {
    if (this.cache) return this.cache;

    const { quakes } = normalizeQuakesCsv(FIXTURE_QUAKES_CSV);
    const filtered = quakes.filter(isLikelyEarthquake);

    if (!this.shiftToNow || filtered.length === 0) {
      this.cache = filtered;
      return filtered;
    }

    const newest = filtered.reduce(
      (max, quake) => Math.max(max, Date.parse(quake.occurredAt)),
      Number.NEGATIVE_INFINITY,
    );
    const offset = Date.now() - newest;

    this.cache = filtered.map((quake) => ({
      ...quake,
      occurredAt: new Date(Date.parse(quake.occurredAt) + offset).toISOString(),
      updatedAt: quake.updatedAt
        ? new Date(Date.parse(quake.updatedAt) + offset).toISOString()
        : null,
    }));

    return this.cache;
  }
}
