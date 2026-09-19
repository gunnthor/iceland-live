/**
 * Webcam site catalogue.
 *
 * Only the catalogue is cached — where the cameras are and what each view looks
 * at. The images themselves are never cached here: they are fetched per request
 * through the proxy, which is what makes them live.
 */

import type { WebcamSite } from "@/domain/webcam";
import { VegagerdinWebcamProvider } from "@/providers/vegagerdin/webcam-provider";
import type { ProviderMeta } from "@/providers/types";
import { TtlCache } from "./cache";

export const WEBCAM_TTL_MS = 6 * 60 * 60 * 1000;
const WEBCAM_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const KEY = "webcams:sites";

type Snapshot = { sites: WebcamSite[]; meta: ProviderMeta };

const cache = new TtlCache<Snapshot>(WEBCAM_TTL_MS, WEBCAM_MAX_STALE_MS);
const provider = new VegagerdinWebcamProvider();
let inFlight: Promise<Snapshot> | null = null;

export async function getWebcamSites(): Promise<Snapshot> {
  const fresh = cache.getFresh(KEY);
  if (fresh) return { sites: fresh.value.sites, meta: { ...fresh.value.meta, freshness: "cached" } };

  inFlight ??= (async () => {
    const result = await provider.fetchSites();
    const snapshot: Snapshot = { sites: result.data, meta: result.meta };
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
      sites: usable.value.sites,
      meta: { ...usable.value.meta, freshness: "stale", degradedReason: reason },
    };
  }
}
