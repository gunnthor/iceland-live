/**
 * The year-long per-region history that baselines are measured against.
 *
 * One upstream request per day: ~35,000 events, 5 MB of CSV, reduced in about
 * 30 ms to ~86 KB of daily counts. That reduction is the whole point — the
 * events themselves are never needed again, and holding them would be a large
 * amount of memory for no benefit.
 *
 * Cached for 24 hours and kept for a fortnight. A baseline that is a day out of
 * date is still a good baseline; having none at all means observations lose
 * their context entirely, so the stale window is generous.
 */

import type { Earthquake } from "@/domain/earthquake";
import type { RegionHistory, RegionHistorySnapshot } from "@/domain/region-history";
import { ImoQuakesProvider } from "@/providers/imo/quakes-provider";
import type { ProviderMeta } from "@/providers/types";
import { TtlCache } from "./cache";

export const HISTORY_DAYS = 365;
export const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY_MAX_STALE_MS = 14 * 24 * 60 * 60 * 1000;
const KEY = "history:regions";

type Snapshot = { history: RegionHistorySnapshot; meta: ProviderMeta };

const cache = new TtlCache<Snapshot>(HISTORY_TTL_MS, HISTORY_MAX_STALE_MS);

/**
 * A separate provider instance with a day-long revalidation window. The
 * catalogue provider refreshes every minute, which would be absurd for a year
 * of history.
 */
const provider = new ImoQuakesProvider({ revalidateSeconds: HISTORY_TTL_MS / 1000 });

let inFlight: Promise<Snapshot> | null = null;

/** Reduces events to per-region daily counts. */
export function reduceToHistory(
  quakes: readonly Earthquake[],
  from: Date,
  to: Date,
): RegionHistorySnapshot {
  const regions: Record<string, RegionHistory> = {};

  for (const quake of quakes) {
    if (!quake.region) continue;
    const day = quake.occurredAt.slice(0, 10);

    let entry = regions[quake.region];
    if (!entry) {
      entry = { region: quake.region, dailyCounts: {}, total: 0, activeDays: 0 };
      regions[quake.region] = entry;
    }

    if (entry.dailyCounts[day] === undefined) {
      entry.dailyCounts[day] = 0;
      entry.activeDays += 1;
    }
    entry.dailyCounts[day] += 1;
    entry.total += 1;
  }

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    days: Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000)),
    regions,
  };
}

/**
 * The year of history, from cache when possible.
 *
 * Returns `null` rather than throwing when it cannot be built: history is
 * context, and losing it should cost an observation its comparison sentence,
 * not take down the page.
 */
export async function getRegionHistory(): Promise<Snapshot | null> {
  const fresh = cache.getFresh(KEY);
  if (fresh) return { ...fresh.value, meta: { ...fresh.value.meta, freshness: "cached" } };

  inFlight ??= (async () => {
    const to = new Date();
    const from = new Date(to.getTime() - HISTORY_DAYS * 86_400_000);
    const result = await provider.fetchEarthquakes({ from, to });

    const snapshot: Snapshot = {
      history: reduceToHistory(result.data, from, to),
      meta: result.meta,
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
    if (usable) {
      return { ...usable.value, meta: { ...usable.value.meta, freshness: "stale" } };
    }
    console.warn(
      `[region-history] unavailable; observations will omit their comparison: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}
