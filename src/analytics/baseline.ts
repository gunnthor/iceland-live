/**
 * Baselines: how an area's current rate compares with its own recent history.
 *
 * ## The question this answers
 *
 * An observation can already say "46 earthquakes within 6 km of Norðurland over
 * 26 hours". What it cannot say is whether that is a lot *for Norðurland*.
 * Forty events a day is routine on the Reykjanes Ridge and remarkable under
 * Öræfajökull, and a reader without that context cannot tell the difference.
 *
 * ## How it is calculated
 *
 * For a named IMO region, against a year of that region's daily counts
 * (see `src/server/region-history.ts`):
 *
 *  1. The **observation window** is reduced to events per day.
 *  2. The **mean rate** over the history window is the baseline, and the ratio
 *     between the two is reported.
 *  3. The window's rate is also **ranked against the distribution** of that
 *     region's daily counts, which is the part that actually answers "is this
 *     unusual" — a 3× ratio means something different in a region that swings
 *     wildly than in one that never does.
 *
 * Days on which a region recorded nothing count as zeros in the distribution.
 * Omitting them would rank today only against days the region was already
 * active, which flatters quiet regions into looking permanently busy.
 *
 * ## What it is not
 *
 * A comparison against one region's own preceding year. It is not a
 * probability, not a forecast, and not a statement that anything is wrong. The
 * period is always stated, and nothing is reported when there is too little
 * history for the comparison to mean anything.
 */

import type { Earthquake } from "@/domain/earthquake";
import {
  dailySeries,
  percentileOf,
  type RegionHistorySnapshot,
} from "@/domain/region-history";

/** Below this many baseline events the comparison is noise, so we say nothing. */
export const MIN_BASELINE_EVENTS = 8;

/** Below this many events in the window there is nothing worth comparing. */
export const MIN_RECENT_EVENTS = 5;

/** A baseline window shorter than this cannot characterise "normal". */
export const MIN_BASELINE_DAYS = 3;

/** Ratios within this band of 1 are reported as "typical" rather than as a number. */
export const TYPICAL_BAND = { low: 0.6, high: 1.6 } as const;

export type RegionBaseline = {
  region: string;
  /** Events per day in the observation window. */
  recentPerDay: number;
  /** Events per day across the baseline window. */
  baselinePerDay: number;
  /** `recentPerDay / baselinePerDay`. */
  ratio: number;
  /** Length of the baseline window, in days. */
  baselineDays: number;
  /** Event counts behind each rate, so the reader can check the arithmetic. */
  recentCount: number;
  baselineCount: number;
  /**
   * Share of days in the history window quieter than this one, in [0, 1].
   * Present only when ranked against a full history rather than a short window.
   */
  percentile?: number;
  /** Highest daily count this region recorded in the history window. */
  historyPeak?: number;
  /**
   * Whether the observation window was removed from the baseline before
   * averaging.
   *
   * It matters which: over a month, leaving the current burst in drags the mean
   * up enough to hide itself, so it is excluded. Over a year one day moves the
   * mean by a fraction of a percent, so it is left in rather than complicating
   * the arithmetic — and the method note says which was done rather than
   * implying one of them.
   */
  excludesWindow: boolean;
};

export type BaselineInput = {
  /** The full catalogue we hold — typically 30 days. */
  catalogue: readonly Earthquake[];
  /** Start of the period being described. */
  from: Date;
  /** End of the period being described. */
  to: Date;
};

function countInRegion(
  quakes: readonly Earthquake[],
  region: string,
  fromMs: number,
  toMs: number,
): number {
  let count = 0;
  for (const quake of quakes) {
    if (quake.region !== region) continue;
    const at = Date.parse(quake.occurredAt);
    if (Number.isFinite(at) && at >= fromMs && at < toMs) count += 1;
  }
  return count;
}

/**
 * Compares a region's rate in the window against its rate over the rest of the
 * catalogue. Returns `null` when there is not enough history to say anything.
 */
export function computeRegionBaseline(
  region: string,
  { catalogue, from, to }: BaselineInput,
): RegionBaseline | null {
  if (catalogue.length === 0) return null;

  const fromMs = from.getTime();
  const toMs = to.getTime();
  const windowDays = (toMs - fromMs) / 86_400_000;
  if (windowDays <= 0) return null;

  // The catalogue's own extent, so the baseline is measured over real coverage
  // rather than an assumed 30 days.
  let earliestMs = Infinity;
  for (const quake of catalogue) {
    const at = Date.parse(quake.occurredAt);
    if (Number.isFinite(at) && at < earliestMs) earliestMs = at;
  }
  if (!Number.isFinite(earliestMs)) return null;

  const baselineDays = (fromMs - earliestMs) / 86_400_000;
  if (baselineDays < MIN_BASELINE_DAYS) return null;

  const recentCount = countInRegion(catalogue, region, fromMs, toMs);
  if (recentCount < MIN_RECENT_EVENTS) return null;

  const baselineCount = countInRegion(catalogue, region, earliestMs, fromMs);
  if (baselineCount < MIN_BASELINE_EVENTS) return null;

  const recentPerDay = recentCount / windowDays;
  const baselinePerDay = baselineCount / baselineDays;
  if (baselinePerDay <= 0) return null;

  return {
    region,
    recentPerDay,
    baselinePerDay,
    ratio: recentPerDay / baselinePerDay,
    baselineDays,
    recentCount,
    baselineCount,
    excludesWindow: true,
  };
}

/**
 * Computes a baseline from a year of that region's daily counts.
 *
 * Preferred over `computeRegionBaseline` wherever history is available: it
 * compares against a year rather than a month, and it can rank the window
 * against the region's own distribution rather than only against its mean.
 */
export function computeHistoricalBaseline(
  region: string,
  window: { from: Date; to: Date },
  recentCount: number,
  history: RegionHistorySnapshot,
): RegionBaseline | null {
  const windowDays = (window.to.getTime() - window.from.getTime()) / 86_400_000;
  if (windowDays <= 0) return null;
  if (recentCount < MIN_RECENT_EVENTS) return null;

  const entry = history.regions[region];
  if (!entry) return null;
  if (entry.total < MIN_BASELINE_EVENTS) return null;
  if (history.days < MIN_BASELINE_DAYS) return null;

  const recentPerDay = recentCount / windowDays;
  const baselinePerDay = entry.total / history.days;
  if (baselinePerDay <= 0) return null;

  const series = dailySeries(entry, history.days);

  return {
    region,
    recentPerDay,
    baselinePerDay,
    ratio: recentPerDay / baselinePerDay,
    baselineDays: history.days,
    recentCount,
    baselineCount: entry.total,
    percentile: percentileOf(series, recentPerDay),
    historyPeak: series.length > 0 ? (series[series.length - 1] as number) : 0,
    excludesWindow: false,
  };
}

/**
 * A plain-language rendering of a ratio.
 *
 * Deliberately flat: "about 3× the usual rate" states a measurement, where
 * "dramatically elevated" would be a judgement we have no standing to make.
 */
export function describeBaseline(baseline: RegionBaseline): string {
  const { ratio, baselineDays, region } = baseline;
  const period = formatPeriod(baselineDays);

  const rate =
    ratio >= TYPICAL_BAND.low && ratio <= TYPICAL_BAND.high
      ? `That is close to the usual rate for ${region} over ${period}.`
      : ratio < TYPICAL_BAND.low
        ? `That is about ${formatFactor(1 / ratio)} lower than the usual rate for ${region} over ${period}.`
        : `That is about ${formatFactor(ratio)} the usual rate for ${region} over ${period}.`;

  const rank = describeRank(baseline);
  return rank ? `${rate} ${rank}` : rate;
}

/**
 * Where this window sits in the region's own distribution.
 *
 * A ratio alone is not enough: 3× the mean is unremarkable in a region that
 * swings by an order of magnitude week to week, and notable in one that does
 * not. Only stated for genuinely high ranks — telling a reader an ordinary day
 * is "busier than 40% of days" is noise.
 *
 * The rank only ever *qualifies* a rate already outside the typical band; it
 * never asserts notability by itself. In a region whose daily count barely
 * varies, a rate a shade above the mean can outrank every day on record while
 * being entirely ordinary, and "close to the usual rate, and among the busiest
 * days ever" is a sentence that contradicts itself.
 */
function describeRank(baseline: RegionBaseline): string | null {
  const { percentile, baselineDays, ratio } = baseline;
  if (percentile === undefined) return null;
  if (percentile < 0.9) return null;
  if (ratio <= TYPICAL_BAND.high) return null;

  const period = formatPeriod(baselineDays);
  const share = Math.round((1 - percentile) * 100);

  if (share <= 0) {
    return `At that rate it is among the busiest days for this area in ${period}.`;
  }
  return `That rate is higher than ${Math.round(percentile * 100)}% of days in ${period}.`;
}

/** "the past year" reads better than "the preceding 365 days". */
function formatPeriod(days: number): string {
  const rounded = Math.round(days);
  if (rounded >= 350 && rounded <= 380) return "the past year";
  if (rounded >= 28 && rounded <= 31) return "the past month";
  return `the preceding ${rounded} ${rounded === 1 ? "day" : "days"}`;
}

/** `2×`, `3.5×`, or `over 20×` where the precise figure stops being meaningful. */
function formatFactor(factor: number): string {
  if (factor >= 20) return "over 20×";
  if (factor >= 10) return `${Math.round(factor)}×`;
  const rounded = Math.round(factor * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}×`;
}

/**
 * The method note shown alongside an observation carrying a baseline.
 *
 * States explicitly that the comparison is region-wide. The observation above
 * it counts a *cluster* — a spatial subset picked out by this window — and a
 * cluster has no history to be compared with, because it did not exist before
 * the window defined it. The region does. Without saying so, the two counts
 * sitting next to each other simply look inconsistent.
 */
export function baselineMethod(baseline: RegionBaseline): string {
  const days = Math.round(baseline.baselineDays);
  const ranking =
    baseline.percentile === undefined
      ? ""
      : ` Ranked against that region's ${days} daily counts, including days with no events; ` +
        `its busiest day saw ${baseline.historyPeak ?? 0}.`;

  const exclusion = baseline.excludesWindow
    ? " The window itself is excluded from the baseline."
    : ` The window is included in the baseline; across ${days} days it moves the mean by a fraction of a percent.`;

  return (
    `Compared across the whole of ${baseline.region}, not just the cluster: ` +
    `${baseline.recentCount} events during this window (${baseline.recentPerDay.toFixed(1)} per day) ` +
    `against ${baseline.baselineCount} over ${formatPeriod(baseline.baselineDays)} ` +
    `(${baseline.baselinePerDay.toFixed(1)} per day).${ranking}${exclusion} ` +
    `This is a comparison against one region's own record, not a probability or a forecast.`
  );
}
