/**
 * Air quality and road conditions.
 *
 * Both are served from one service and one route: a reader asking "is it safe
 * to go to Grindavík" wants the gas reading and the road status together, and
 * splitting them would mean two round trips to answer one question.
 *
 * Each source is fetched independently and may fail on its own — air quality
 * being down should not cost the road conditions.
 *
 * Cached for 5 minutes: the air network publishes hourly averages and the road
 * feeds update every few minutes, so anything tighter re-fetches unchanged data.
 */

import type { AirQualityStation } from "@/domain/air-quality";
import type { RoadCondition, RoadWeatherStation } from "@/domain/roads";
import { UstAirQualityProvider } from "@/providers/ust/air-quality-provider";
import { VegagerdinRoadsProvider } from "@/providers/vegagerdin/roads-provider";
import { ProviderError, type ProviderMeta } from "@/providers/types";
import { TtlCache } from "./cache";

export const ENVIRONMENT_TTL_MS = 5 * 60_000;
const ENVIRONMENT_MAX_STALE_MS = 60 * 60_000;
const KEY = "environment:all";

export type EnvironmentSnapshot = {
  air: AirQualityStation[];
  /** Present when the air network could not be reached. */
  airError: string | null;
  roadWeather: RoadWeatherStation[];
  roadConditions: RoadCondition[];
  roadsError: string | null;
  meta: ProviderMeta;
};

const cache = new TtlCache<EnvironmentSnapshot>(ENVIRONMENT_TTL_MS, ENVIRONMENT_MAX_STALE_MS);
const airProvider = new UstAirQualityProvider();
const roadsProvider = new VegagerdinRoadsProvider();
let inFlight: Promise<EnvironmentSnapshot> | null = null;

function reason(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  return error instanceof Error ? error.message : "Unknown upstream failure";
}

export async function getEnvironment(): Promise<EnvironmentSnapshot> {
  const fresh = cache.getFresh(KEY);
  if (fresh) return { ...fresh.value, meta: { ...fresh.value.meta, freshness: "cached" } };

  inFlight ??= (async () => {
    const [air, roads] = await Promise.all([
      airProvider.fetchStations().catch((error: unknown) => {
        console.warn(`[environment] air quality unavailable: ${reason(error)}`);
        return { error: reason(error) } as const;
      }),
      roadsProvider.fetchRoads().catch((error: unknown) => {
        console.warn(`[environment] road data unavailable: ${reason(error)}`);
        return { error: reason(error) } as const;
      }),
    ]);

    const airOk = "data" in air;
    const roadsOk = "data" in roads;

    // If neither source answered there is nothing to cache; let the caller fall
    // back to a stale snapshot or report the failure.
    if (!airOk && !roadsOk) {
      throw new ProviderError("network", "Neither air quality nor road data could be reached.");
    }

    const snapshot: EnvironmentSnapshot = {
      air: airOk ? air.data : [],
      airError: airOk ? null : air.error,
      roadWeather: roadsOk ? roads.data.weather : [],
      roadConditions: roadsOk ? roads.data.conditions : [],
      roadsError: roadsOk ? null : roads.error,
      meta: airOk
        ? air.meta
        : (roads as Extract<typeof roads, { meta: ProviderMeta }>).meta,
    };

    cache.set(KEY, snapshot);
    return snapshot;
  })().finally(() => {
    inFlight = null;
  });

  try {
    return await inFlight;
  } catch (error) {
    const usable = cache.getUsable(KEY);
    if (!usable) throw error;
    return {
      ...usable.value,
      meta: { ...usable.value.meta, freshness: "stale", degradedReason: reason(error) },
    };
  }
}
