/**
 * Deformation and monitoring-network service.
 *
 * Both catalogues change on the order of days to years, so they are cached for
 * six hours and kept for a week. The interferogram list is ~340 KB upstream and
 * reduces to a few kilobytes once normalized.
 */

import type { GnssStation, Interferogram } from "@/domain/deformation";
import { ImoEposProvider } from "@/providers/imo/epos-provider";
import type { ProviderMeta } from "@/providers/types";
import { TtlCache } from "./cache";

export const DEFORMATION_TTL_MS = 6 * 60 * 60 * 1000;
const DEFORMATION_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;

type Snapshot = {
  interferograms: Interferogram[];
  stations: GnssStation[];
  meta: ProviderMeta;
};

const cache = new TtlCache<Snapshot>(DEFORMATION_TTL_MS, DEFORMATION_MAX_STALE_MS);
const provider = new ImoEposProvider();
let inFlight: Promise<Snapshot> | null = null;
const KEY = "deformation:all";

export async function getDeformation(): Promise<Snapshot> {
  const fresh = cache.getFresh(KEY);
  if (fresh) return { ...fresh.value, meta: { ...fresh.value.meta, freshness: "cached" } };

  inFlight ??= (async () => {
    // Either half is useful alone: a failed station list should not cost us
    // the interferograms, and vice versa.
    const [interferograms, stations] = await Promise.all([
      provider.fetchInterferograms(),
      provider.fetchGnssStations().catch((error: unknown) => {
        console.warn(
          `[deformation] GNSS station list unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      }),
    ]);

    const snapshot: Snapshot = {
      interferograms: interferograms.data,
      stations: stations?.data ?? [],
      meta: interferograms.meta,
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
    const reason = error instanceof Error ? error.message : "Unknown upstream failure";
    return {
      ...usable.value,
      meta: { ...usable.value.meta, freshness: "stale", degradedReason: reason },
    };
  }
}
