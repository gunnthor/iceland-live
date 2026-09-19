/**
 * Server-side earthquake service.
 *
 * ## Fetch strategy
 *
 * We request one window from IMO — the widest the UI offers (30 days) — and
 * slice it in memory for every range. The consequences:
 *
 *   * Switching between 1h and 30d costs no upstream request at all.
 *   * Upstream load is a function of time, not of traffic or of how many ranges
 *     people click through: roughly one request per revalidation window per
 *     deployment.
 *   * The catalogue is parsed once per window rather than once per request.
 *
 * ## Caching
 *
 * `SNAPSHOT_TTL_MS` (60s) governs freshness. IMO publishes automatic solutions
 * within about a minute, so a shorter window would mostly re-fetch unchanged
 * data. Past the TTL we still keep the snapshot for up to `MAX_STALE_MS`
 * (6 hours) and serve it if IMO is unreachable, marked `stale` so the interface
 * can say the data is not current. We never fall back to fixtures here.
 */

import type { Earthquake } from "@/domain/earthquake";
import { MAX_RANGE, TIME_RANGES } from "@/domain/time-range";
import { getEarthquakeProvider } from "@/providers/registry";
import { ProviderError, type ProviderMeta } from "@/providers/types";
import { TtlCache } from "./cache";

export const SNAPSHOT_TTL_MS = 60_000;
export const MAX_STALE_MS = 6 * 60 * 60 * 1000;

const SNAPSHOT_KEY = "quakes:max-window";

type Snapshot = {
  quakes: Earthquake[];
  meta: ProviderMeta;
  /** End of the window this snapshot covers. */
  windowTo: string;
};

const cache = new TtlCache<Snapshot>(SNAPSHOT_TTL_MS, MAX_STALE_MS);

/** In-flight request sharing: concurrent callers await one upstream fetch. */
let inFlight: Promise<Snapshot> | null = null;

export type SnapshotResult = {
  quakes: Earthquake[];
  meta: ProviderMeta;
};

/**
 * Returns the widest earthquake window, from cache when possible.
 *
 * Throws only when there is no usable data at all — a live fetch failed *and*
 * no snapshot is held. Callers turn that into an explicit unavailable state.
 */
export async function getEarthquakeSnapshot(): Promise<SnapshotResult> {
  const fresh = cache.getFresh(SNAPSHOT_KEY);
  if (fresh) {
    return {
      quakes: fresh.value.quakes,
      meta: { ...fresh.value.meta, freshness: cachedFreshness(fresh.value.meta) },
    };
  }

  inFlight ??= refresh().finally(() => {
    inFlight = null;
  });

  try {
    const snapshot = await inFlight;
    return { quakes: snapshot.quakes, meta: snapshot.meta };
  } catch (error) {
    const usable = cache.getUsable(SNAPSHOT_KEY);
    if (!usable) throw error;

    const reason =
      error instanceof ProviderError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown upstream failure";

    console.warn(`[earthquakes] serving stale snapshot: ${reason}`);

    return {
      quakes: usable.value.quakes,
      meta: {
        ...usable.value.meta,
        freshness: "stale",
        degradedReason: reason,
      },
    };
  }
}

async function refresh(): Promise<Snapshot> {
  const provider = getEarthquakeProvider();
  const to = new Date();
  const from = new Date(to.getTime() - TIME_RANGES[MAX_RANGE].durationMs);

  const result = await provider.fetchEarthquakes({ from, to });

  const snapshot: Snapshot = {
    quakes: result.data,
    meta: result.meta,
    windowTo: to.toISOString(),
  };

  cache.set(SNAPSHOT_KEY, snapshot);
  return snapshot;
}

/** A fixture stays a fixture when it comes back out of the cache. */
function cachedFreshness(meta: ProviderMeta): ProviderMeta["freshness"] {
  return meta.freshness === "fixture" ? "fixture" : "cached";
}
