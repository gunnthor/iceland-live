/**
 * Per-event detail service.
 *
 * A solution is revised a handful of times shortly after the event and then
 * settles, so this caches for 5 minutes and keeps a stale copy for an hour.
 * Entries are keyed by event id, and the cache is bounded — a crawler walking
 * every event in a 30-day window must not grow this without limit.
 */

import type { EarthquakeDetail } from "@/domain/earthquake-detail";
import { getEarthquakeProvider } from "@/providers/registry";
import { ProviderError, type ProviderMeta } from "@/providers/types";
import { TtlCache } from "./cache";

export const DETAIL_TTL_MS = 5 * 60_000;
const DETAIL_MAX_STALE_MS = 60 * 60_000;

type Snapshot = { detail: EarthquakeDetail; meta: ProviderMeta };

const cache = new TtlCache<Snapshot>(DETAIL_TTL_MS, DETAIL_MAX_STALE_MS, 500);
const inFlight = new Map<string, Promise<Snapshot>>();

/** `null` when the provider has no per-event endpoint. */
export async function getEarthquakeDetail(id: string): Promise<Snapshot | null> {
  const provider = getEarthquakeProvider();
  if (!provider.fetchEarthquakeDetail) return null;

  const fresh = cache.getFresh(id);
  if (fresh) {
    return { detail: fresh.value.detail, meta: { ...fresh.value.meta, freshness: "cached" } };
  }

  let pending = inFlight.get(id);
  if (!pending) {
    pending = (async () => {
      const result = await provider.fetchEarthquakeDetail!(id);
      const snapshot: Snapshot = { detail: result.data, meta: result.meta };
      cache.set(id, snapshot);
      return snapshot;
    })().finally(() => inFlight.delete(id));
    inFlight.set(id, pending);
  }

  try {
    return await pending;
  } catch (error) {
    // A 404 means the event does not exist; there is nothing stale to fall back
    // on and the caller should say so rather than retry.
    if (error instanceof ProviderError && error.status === 404) throw error;

    const usable = cache.getUsable(id);
    if (!usable) throw error;
    const reason = error instanceof Error ? error.message : "Unknown upstream failure";
    return {
      detail: usable.value.detail,
      meta: { ...usable.value.meta, freshness: "stale", degradedReason: reason },
    };
  }
}
