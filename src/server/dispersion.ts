/**
 * Current dispersal simulations.
 *
 * Cached for 15 minutes. IMO produces these a few times a day, and the join
 * behind them costs one catalogue request plus one per scenario, so refetching
 * per visitor would spend a dozen upstream requests to learn nothing new.
 *
 * A stale snapshot is served rather than an error when IMO is unreachable, and
 * labelled as such — the runs themselves are still exactly what IMO produced,
 * they are just no longer being refreshed.
 */

import type { DispersionPointSeries } from "@/domain/dispersion";
import { withinBounds, type DispersionRun } from "@/domain/dispersion";
import { ImoDispersionProvider } from "@/providers/imo/dispersion-provider";
import { ProviderError, type ProviderMeta } from "@/providers/types";
import { TtlCache } from "./cache";

export const DISPERSION_TTL_MS = 15 * 60_000;
const DISPERSION_MAX_STALE_MS = 6 * 60 * 60_000;
const KEY = "dispersion:runs";

export type DispersionSnapshot = { runs: DispersionRun[]; meta: ProviderMeta };

const cache = new TtlCache<DispersionSnapshot>(DISPERSION_TTL_MS, DISPERSION_MAX_STALE_MS);
const provider = new ImoDispersionProvider();
let inFlight: Promise<DispersionSnapshot> | null = null;

export async function getDispersionRuns(): Promise<DispersionSnapshot> {
  const fresh = cache.getFresh(KEY);
  if (fresh) return { runs: fresh.value.runs, meta: { ...fresh.value.meta, freshness: "cached" } };

  inFlight ??= (async () => {
    const result = await provider.fetchRuns();
    const snapshot: DispersionSnapshot = { runs: result.data, meta: result.meta };
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
    const reason =
      error instanceof ProviderError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown upstream failure";

    /*
     * A spent run is dropped even from the stale copy. Everything else here
     * degrades by getting older; a forecast window that has elapsed stops
     * being a forecast, and showing one under a heading about the next two
     * days would be the one misreading this feature cannot afford.
     */
    const now = Date.now();
    const stillCurrent = usable.value.runs.filter(
      (run) => Date.parse(run.startsAt) + run.durationHours * 3_600_000 >= now,
    );

    return {
      runs: stillCurrent,
      meta: { ...usable.value.meta, freshness: "stale", degradedReason: reason },
    };
  }
}

/**
 * Modelled series at one place, cached.
 *
 * Keyed by run and rounded coordinates. Three decimals is about 100 m, well
 * inside the model's own grid spacing, so rounding costs no resolution and
 * turns a stream of near-identical probes into one upstream request.
 *
 * Size-capped as well as time-capped: the key includes a coordinate, so it is
 * unbounded in a way the other caches here are not.
 */
const POINT_TTL_MS = 60 * 60_000;
const POINT_MAX_STALE_MS = 6 * 60 * 60_000;
const POINT_MAX_ENTRIES = 400;

const pointCache = new TtlCache<DispersionPointSeries[]>(
  POINT_TTL_MS,
  POINT_MAX_STALE_MS,
  POINT_MAX_ENTRIES,
);

export type PointLookup =
  | { ok: true; run: DispersionRun; series: DispersionPointSeries[] }
  | { ok: false; reason: "unknown-run" | "outside-grid" | "unavailable" };

export async function getDispersionPoint(
  runId: string,
  latitude: number,
  longitude: number,
): Promise<PointLookup> {
  let run: DispersionRun | undefined;
  try {
    run = (await getDispersionRuns()).runs.find((item) => item.id === runId);
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  // Only runs we are currently serving. Relaying an arbitrary UUID would make
  // this a general-purpose proxy for someone else's service.
  if (!run) return { ok: false, reason: "unknown-run" };

  /*
   * Outside the grid the service answers 200 with zeros, which would read as
   * "the model says nothing will reach here" when the truth is "this place was
   * never modelled". Refused rather than passed on.
   */
  if (!withinBounds(run.bounds, { latitude, longitude })) {
    return { ok: false, reason: "outside-grid" };
  }

  const lat = Math.round(latitude * 1000) / 1000;
  const lon = Math.round(longitude * 1000) / 1000;
  const key = `${runId}:${lat}:${lon}`;

  const fresh = pointCache.getFresh(key);
  if (fresh) return { ok: true, run, series: fresh.value };

  try {
    const result = await provider.fetchPointSeries(runId, lat, lon);
    pointCache.set(key, result.data);
    return { ok: true, run, series: result.data };
  } catch (error) {
    const usable = pointCache.getUsable(key);
    if (usable) return { ok: true, run, series: usable.value };
    console.warn(`[dispersion] point lookup failed for ${runId}`, error);
    return { ok: false, reason: "unavailable" };
  }
}
