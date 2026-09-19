/**
 * Reykjanes layer service.
 *
 * These are historical survey products that will not change, so they are
 * cached for a day in process and kept for a week as a fallback. The upstream
 * fetch is several megabytes before simplification and takes seconds, which is
 * exactly the kind of work that must happen once per server rather than once
 * per visitor.
 */

import type { ReykjanesLayer } from "@/domain/reykjanes";
import { ReykjanesGisProvider } from "@/providers/gis/reykjanes-provider";
import type { ProviderMeta } from "@/providers/types";
import { TtlCache } from "./cache";

export const REYKJANES_TTL_MS = 24 * 60 * 60 * 1000;
const REYKJANES_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const KEY = "reykjanes:layer";

type Snapshot = { layer: ReykjanesLayer; meta: ProviderMeta };

const cache = new TtlCache<Snapshot>(REYKJANES_TTL_MS, REYKJANES_MAX_STALE_MS);
const provider = new ReykjanesGisProvider();
let inFlight: Promise<Snapshot> | null = null;

export async function getReykjanesLayer(): Promise<Snapshot> {
  const fresh = cache.getFresh(KEY);
  if (fresh) {
    return { layer: fresh.value.layer, meta: { ...fresh.value.meta, freshness: "cached" } };
  }

  inFlight ??= (async () => {
    const result = await provider.fetchLayer();
    const snapshot: Snapshot = { layer: result.data, meta: result.meta };
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
    const reason = error instanceof Error ? error.message : "Unknown upstream failure";
    return {
      layer: usable.value.layer,
      meta: { ...usable.value.meta, freshness: "stale", degradedReason: reason },
    };
  }
}
