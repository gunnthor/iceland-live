/**
 * Descriptive statistics over a set of normalized earthquakes.
 *
 * Everything here is a plain arithmetic summary of the events we were given.
 * Nothing in this module infers, forecasts or interprets — it counts, sorts and
 * averages.
 */

import type { Earthquake } from "@/domain/earthquake";

export type EarthquakeStats = {
  /** Number of events in the window. */
  count: number;
  /** Highest-magnitude event, or null when no event carries a magnitude. */
  largest: Earthquake | null;
  /** Deepest event, or null when no event carries a depth. */
  deepest: Earthquake | null;
  /** Most recent event by origin time. */
  latest: Earthquake | null;
  /** Median depth in km across events that report one. */
  medianDepthKm: number | null;
  /** Events at or above magnitude 2.0 — roughly the level people start to feel. */
  countM2Plus: number;
  /** Events at or above magnitude 3.0. */
  countM3Plus: number;
  /** Events whose solution a seismologist has reviewed. */
  reviewedCount: number;
  /** Events per hour across the window, or null when the window has no length. */
  ratePerHour: number | null;
};

/** Events within [from, to). Times are compared as instants, not strings. */
export function filterByRange(
  quakes: readonly Earthquake[],
  from: Date,
  to: Date,
): Earthquake[] {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  return quakes.filter((quake) => {
    const at = Date.parse(quake.occurredAt);
    return Number.isFinite(at) && at >= fromMs && at < toMs;
  });
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

/**
 * Picks the single event that maximises `score`.
 *
 * Ties break toward the more recent event, so "largest" stays stable and
 * reports the freshest of equally sized events.
 */
function pickBy(
  quakes: readonly Earthquake[],
  score: (quake: Earthquake) => number | null,
): Earthquake | null {
  let best: Earthquake | null = null;
  let bestScore = -Infinity;

  for (const quake of quakes) {
    const value = score(quake);
    if (value === null || !Number.isFinite(value)) continue;
    if (
      value > bestScore ||
      (value === bestScore && best !== null && quake.occurredAt > best.occurredAt)
    ) {
      best = quake;
      bestScore = value;
    }
  }
  return best;
}

export function computeStats(
  quakes: readonly Earthquake[],
  window?: { from: Date; to: Date },
): EarthquakeStats {
  const depths = quakes
    .map((quake) => quake.depthKm)
    .filter((depth): depth is number => depth !== null && Number.isFinite(depth));

  const windowHours = window
    ? (window.to.getTime() - window.from.getTime()) / 3_600_000
    : null;

  return {
    count: quakes.length,
    largest: pickBy(quakes, (quake) => quake.magnitude),
    deepest: pickBy(quakes, (quake) => quake.depthKm),
    latest: pickBy(quakes, (quake) => Date.parse(quake.occurredAt)),
    medianDepthKm: median(depths),
    countM2Plus: quakes.filter((quake) => (quake.magnitude ?? -Infinity) >= 2).length,
    countM3Plus: quakes.filter((quake) => (quake.magnitude ?? -Infinity) >= 3).length,
    reviewedCount: quakes.filter((quake) => quake.reviewStatus === "reviewed").length,
    ratePerHour:
      windowHours !== null && windowHours > 0 ? quakes.length / windowHours : null,
  };
}

export type RegionTally = {
  region: string;
  count: number;
  /** Highest magnitude recorded in this region during the window. */
  largestMagnitude: number | null;
  /** Mean position of the region's events, for framing the map. */
  centre: { latitude: number; longitude: number } | null;
  /** Most recent event in this region, ISO instant. */
  latestAt: string | null;
  /**
   * How this window compares with the region's own year, when history allows.
   * Computed by the server and attached here so the list can rank by it.
   */
  ratio?: number;
  /** Share of days in the past year quieter than this window's rate. */
  percentile?: number;
};

/** Event counts per IMO seismic region, busiest first. */
export function tallyByRegion(quakes: readonly Earthquake[]): RegionTally[] {
  type Accumulator = {
    count: number;
    largest: number | null;
    latestAt: string | null;
    latSum: number;
    lonSum: number;
  };

  const tally = new Map<string, Accumulator>();

  for (const quake of quakes) {
    if (!quake.region) continue;
    const entry =
      tally.get(quake.region) ??
      { count: 0, largest: null, latestAt: null, latSum: 0, lonSum: 0 };

    entry.count += 1;
    entry.latSum += quake.latitude;
    entry.lonSum += quake.longitude;

    if (quake.magnitude !== null && (entry.largest === null || quake.magnitude > entry.largest)) {
      entry.largest = quake.magnitude;
    }
    if (entry.latestAt === null || quake.occurredAt > entry.latestAt) {
      entry.latestAt = quake.occurredAt;
    }

    tally.set(quake.region, entry);
  }

  return [...tally.entries()]
    .map(([region, entry]) => ({
      region,
      count: entry.count,
      largestMagnitude: entry.largest,
      latestAt: entry.latestAt,
      centre: {
        latitude: entry.latSum / entry.count,
        longitude: entry.lonSum / entry.count,
      },
    }))
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region, "is"));
}
