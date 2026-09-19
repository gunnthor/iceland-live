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

import type { DispersionRun } from "@/domain/dispersion";
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
