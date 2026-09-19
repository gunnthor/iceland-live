/**
 * Server-side volcanic-system service.
 *
 * Geometry from the Catalogue of Icelandic Volcanoes is effectively static, and
 * aviation colour codes change on the order of weeks, so this is cached for an
 * hour and kept for a day as a stale fallback. A volcano layer that is an hour
 * out of date is fine; a missing one is not.
 */

import type { VolcanicSystem } from "@/domain/volcano";
import { getVolcanoProvider } from "@/providers/registry";
import type { ProviderMeta } from "@/providers/types";
import { TtlCache } from "./cache";

export const VOLCANO_TTL_MS = 60 * 60 * 1000;
const VOLCANO_MAX_STALE_MS = 24 * 60 * 60 * 1000;
const KEY = "volcanoes:all";

type Snapshot = { systems: VolcanicSystem[]; meta: ProviderMeta };

const cache = new TtlCache<Snapshot>(VOLCANO_TTL_MS, VOLCANO_MAX_STALE_MS);
let inFlight: Promise<Snapshot> | null = null;

export async function getVolcanicSystems(): Promise<Snapshot> {
  const fresh = cache.getFresh(KEY);
  if (fresh) {
    return { systems: fresh.value.systems, meta: { ...fresh.value.meta, freshness: "cached" } };
  }

  inFlight ??= (async () => {
    const result = await getVolcanoProvider().fetchVolcanicSystems();
    const snapshot: Snapshot = { systems: result.data, meta: result.meta };
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
      systems: usable.value.systems,
      meta: { ...usable.value.meta, freshness: "stale", degradedReason: reason },
    };
  }
}
