/**
 * Official warnings service.
 *
 * Cached for 3 minutes and kept for 30 as a stale fallback. The stale window is
 * deliberately much shorter than for earthquakes: an out-of-date map of past
 * seismicity is still true, whereas an out-of-date warning may have been
 * cancelled. When we cannot reach the broker we would rather say so than keep
 * a lapsed warning on screen.
 */

import type { OfficialAlert } from "@/domain/alert";
import { getAlertProvider } from "@/providers/registry";
import type { ProviderMeta } from "@/providers/types";
import { TtlCache } from "./cache";

export const ALERTS_TTL_MS = 3 * 60_000;
const ALERTS_MAX_STALE_MS = 30 * 60_000;
const KEY = "alerts:active";

type Snapshot = { alerts: OfficialAlert[]; meta: ProviderMeta };

const cache = new TtlCache<Snapshot>(ALERTS_TTL_MS, ALERTS_MAX_STALE_MS);
let inFlight: Promise<Snapshot> | null = null;

export async function getActiveAlerts(): Promise<Snapshot> {
  const fresh = cache.getFresh(KEY);
  if (fresh) {
    return { alerts: fresh.value.alerts, meta: { ...fresh.value.meta, freshness: "cached" } };
  }

  inFlight ??= (async () => {
    const result = await getAlertProvider().fetchActiveAlerts();
    const snapshot: Snapshot = { alerts: result.data, meta: result.meta };
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
      alerts: usable.value.alerts,
      meta: { ...usable.value.meta, freshness: "stale", degradedReason: reason },
    };
  }
}
