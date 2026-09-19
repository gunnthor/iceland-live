/**
 * Provider selection.
 *
 * Exactly one place decides which implementation backs each kind of data, so
 * swapping or adding a source never reaches into feature code.
 */

import { ImoQuakesProvider } from "@/providers/imo/quakes-provider";
import { ImoVolcanoProvider } from "@/providers/imo/volcano-provider";
import { FixtureEarthquakeProvider } from "@/providers/fixtures/fixture-provider";
import type { EarthquakeProvider, VolcanoProvider } from "@/providers/types";

/**
 * Fixtures exist so the UI can be developed without network access. They are a
 * frozen snapshot, never "live" data, and the API surfaces them as
 * `freshness: "fixture"` so the interface can say so.
 *
 * Using them in a production build requires an explicit opt-in, so a
 * misconfigured deploy fails loudly rather than quietly serving a snapshot as
 * if it were current.
 */
function fixturesAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ALLOW_FIXTURES_IN_PRODUCTION === "true";
}

let earthquakeProvider: EarthquakeProvider | null = null;
let volcanoProvider: VolcanoProvider | null = null;

export function getEarthquakeProvider(): EarthquakeProvider {
  if (earthquakeProvider) return earthquakeProvider;

  if (process.env.EARTHQUAKE_SOURCE === "fixture") {
    if (!fixturesAllowed()) {
      throw new Error(
        "EARTHQUAKE_SOURCE=fixture is not permitted in production. " +
          "Set ALLOW_FIXTURES_IN_PRODUCTION=true only for a deliberate demo deployment.",
      );
    }
    earthquakeProvider = new FixtureEarthquakeProvider();
  } else {
    earthquakeProvider = new ImoQuakesProvider();
  }

  return earthquakeProvider;
}

export function getVolcanoProvider(): VolcanoProvider {
  volcanoProvider ??= new ImoVolcanoProvider();
  return volcanoProvider;
}
