/**
 * The road network as line work, cached hard.
 *
 * About 1,565 segments over two paginated requests, generalised by the
 * service to roughly two kilometres. It is used only to ask which routes a
 * modelled footprint covers, so it never reaches a browser — only the names
 * that matched do.
 *
 * Cached for a day in memory and mirrored to disk, because the lines change on
 * the order of roadworks while everything else in this product changes by the
 * minute. A cold start reads local JSON instead of ~330 KB over two round
 * trips.
 */

import type { RoadSegmentLine } from "@/domain/roads";
import { VegagerdinRoadNetworkProvider } from "@/providers/vegagerdin/road-geometry-provider";
import { readDiskCache, writeDiskCache } from "./disk-cache";
import { TtlCache } from "./cache";

export const NETWORK_TTL_MS = 24 * 60 * 60_000;
const NETWORK_MAX_STALE_MS = 14 * 24 * 60 * 60_000;
const KEY = "roads:network";

/** Bumped when `RoadSegmentLine` changes, so old files are ignored. */
const DISK_VERSION = 1;
const DISK_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const cache = new TtlCache<RoadSegmentLine[]>(NETWORK_TTL_MS, NETWORK_MAX_STALE_MS);
const provider = new VegagerdinRoadNetworkProvider();
let inFlight: Promise<RoadSegmentLine[]> | null = null;

/**
 * Returns the network, or an empty list when it cannot be had.
 *
 * Empty rather than a throw: the road list is one section of one panel, and
 * losing it should cost that section rather than the dispersal feature it
 * sits inside.
 */
export async function getRoadNetwork(): Promise<RoadSegmentLine[]> {
  const fresh = cache.getFresh(KEY);
  if (fresh) return fresh.value;

  inFlight ??= (async () => {
    const stored = await readDiskCache<RoadSegmentLine[]>(KEY, DISK_VERSION, DISK_MAX_AGE_MS);
    if (stored && stored.length > 0) {
      cache.set(KEY, stored);
      return stored;
    }

    const result = await provider.fetchAllSegments();
    cache.set(KEY, result.data);
    void writeDiskCache(KEY, DISK_VERSION, result.data);
    return result.data;
  })().finally(() => {
    inFlight = null;
  });

  try {
    return await inFlight;
  } catch (error) {
    const usable = cache.getUsable(KEY);
    if (usable) return usable.value;
    console.warn("[road-network] unavailable", error);
    return [];
  }
}
