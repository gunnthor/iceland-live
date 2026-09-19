/**
 * Time binning for the activity timeline.
 *
 * Bin widths are chosen per range so the chart always shows a comparable number
 * of bars (roughly 30–60) regardless of whether the user is looking at one hour
 * or thirty days. Bin edges are aligned to the window start rather than to
 * wall-clock boundaries, which keeps the rightmost bin flush with "now".
 */

import type { Earthquake } from "@/domain/earthquake";
import { TIME_RANGES, type TimeRangeId } from "@/domain/time-range";

export type TimeBin = {
  /** Inclusive start of the bin, epoch milliseconds. */
  startMs: number;
  /** Exclusive end of the bin, epoch milliseconds. */
  endMs: number;
  count: number;
  /** Largest magnitude in the bin, or null when no event reports one. */
  maxMagnitude: number | null;
};

export type Histogram = {
  bins: TimeBin[];
  binMs: number;
  fromMs: number;
  toMs: number;
  /** Highest count in any bin; the chart's y-axis maximum. */
  peakCount: number;
};

/** Bin width per range, in milliseconds. */
const BIN_MS: Record<TimeRangeId, number> = {
  "1h": 2 * 60_000, //   2 minutes -> 30 bins
  "6h": 10 * 60_000, //  10 minutes -> 36 bins
  "24h": 30 * 60_000, // 30 minutes -> 48 bins
  "7d": 3 * 3_600_000, //  3 hours  -> 56 bins
  "30d": 12 * 3_600_000, // 12 hours -> 60 bins
};

export function binWidthMs(range: TimeRangeId): number {
  return BIN_MS[range];
}

export function buildHistogram(
  quakes: readonly Earthquake[],
  range: TimeRangeId,
  to: Date,
): Histogram {
  const binMs = BIN_MS[range];
  const toMs = to.getTime();
  const fromMs = toMs - TIME_RANGES[range].durationMs;
  const binCount = Math.max(1, Math.round(TIME_RANGES[range].durationMs / binMs));

  const bins: TimeBin[] = Array.from({ length: binCount }, (_, i) => ({
    startMs: fromMs + i * binMs,
    endMs: fromMs + (i + 1) * binMs,
    count: 0,
    maxMagnitude: null,
  }));

  for (const quake of quakes) {
    const at = Date.parse(quake.occurredAt);
    if (!Number.isFinite(at) || at < fromMs || at >= toMs) continue;

    const index = Math.min(binCount - 1, Math.floor((at - fromMs) / binMs));
    const bin = bins[index];
    if (!bin) continue;

    bin.count += 1;
    if (quake.magnitude !== null && (bin.maxMagnitude === null || quake.magnitude > bin.maxMagnitude)) {
      bin.maxMagnitude = quake.magnitude;
    }
  }

  return {
    bins,
    binMs,
    fromMs,
    toMs,
    peakCount: bins.reduce((max, bin) => Math.max(max, bin.count), 0),
  };
}
